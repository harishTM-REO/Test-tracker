/**
 * Detects Webtrends Optimize (WTO) on a page by injecting WTO's own
 * devtools script and reading the experiment data it collects.
 *
 * Must run inside a browser page context (e.g. via Puppeteer's
 * `page.evaluate(loadWTOAndGetExperimentData, timeoutMs)`).
 */
async function loadWTOAndGetExperimentData(timeoutMs) {
  timeoutMs = timeoutMs || 10000;

  function injectScript() {
    return new Promise(function (resolve, reject) {
      var scriptId = "wto-devtools-script";
      var existing = document.getElementById(scriptId);
      if (existing) {
        if (window.WTOdevtools) {
          window.WTOdevtools.init && window.WTOdevtools.init();
        }
        resolve();
        return;
      }
      var s = document.createElement("script");
      s.id = scriptId;
      s.src = "https://c.webtrends-optimize.com/acs/accounts/d25dc2a4-010d-4fd1-a1ad-41e81138c16d/manager/wto-devtools_prod_min.js";
      s.onload = function () { resolve(); };
      s.onerror = function () {
        document.body.removeChild(s);
        reject(new Error("Error while loading WTO ForceExp script."));
      };
      document.body.appendChild(s);
    });
  }

  function currentProjectCount() {
    var data = window.WTOdevtools && window.WTOdevtools.data;
    return data && data.projects ? Object.keys(data.projects).length : -1;
  }

  /**
   * `window.WTOdevtools.data` exists (truthy) as soon as the devtools
   * script initializes, but `data.projects` is populated progressively
   * over the following couple of seconds. Waiting only for `data` to
   * exist (rather than for `projects` to stop growing) reads it before
   * it's fully populated and undercounts experiments — often to zero.
   * Instead, poll until the project count holds steady for a few ticks.
   */
  function waitForStableData(timeout) {
    return new Promise(function (resolve, reject) {
      var start = Date.now();
      var lastCount = -1;
      var stableTicks = 0;
      var REQUIRED_STABLE_TICKS = 4; // ~2s of no change
      var POLL_INTERVAL = 500;

      (function poll() {
        var count = currentProjectCount();
        if (count >= 0) {
          stableTicks = (count === lastCount) ? stableTicks + 1 : 0;
          lastCount = count;
          if (stableTicks >= REQUIRED_STABLE_TICKS) {
            resolve();
            return;
          }
        }
        if (Date.now() - start > timeout) {
          if (lastCount >= 0) {
            resolve(); // got some data, just never fully settled — use what we have
          } else {
            reject(new Error("Timed out waiting for WTOdevtools data."));
          }
          return;
        }
        setTimeout(poll, POLL_INTERVAL);
      })();
    });
  }

  function getWTOExperimentData() {
    var result = { WTO: false, experimentCount: 0, experiments: [] };
    if (typeof window.WTOdevtools === 'undefined' || !window.WTOdevtools.data) {
      return result;
    }
    result.WTO = true;
    var projects = window.WTOdevtools.data.projects || {};

    // One entry per test (WTO's unit of a running experiment), not per
    // variation id inside it — a single A/B test with 2 variations is
    // one experiment, not two.
    var experiments = [];
    Object.keys(projects).forEach(function (pKey) {
      var project = projects[pKey];
      (project.tests || []).forEach(function (test) {
        experiments.push({
          id: test.testID || test.id,
          name: test.testName || project.projectName || project.projectAlias,
          projectId: test.projectID || project.projectID,
          projectAlias: project.projectAlias,
          runState: test.runStateName || null,
          isActive: test.runStateName === 'Live'
        });
      });
    });

    result.experiments = experiments;
    result.experimentCount = experiments.length;
    return result;
  }

  try {
    await injectScript();
    await waitForStableData(timeoutMs);
  } catch (e) {
    // If loading/timeout fails, getWTOExperimentData() just returns WTO:false
  }
  return getWTOExperimentData();
}

module.exports = loadWTOAndGetExperimentData;
