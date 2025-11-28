function sanitizeExperiments(experiments = []) {
  if (!Array.isArray(experiments)) {
    return [];
  }

  return experiments.map(experiment => {
    const sanitized = {
      experimentId: experiment?.experimentId,
      experimentName: experiment?.experimentName,
      status: experiment?.status
    };

    if (Array.isArray(experiment?.variations) && experiment.variations.length > 0) {
      sanitized.variations = experiment.variations.map(variation => ({
        id: variation?.id,
        name: variation?.name
      })).filter(variation => variation.id || variation.name);
    }

    if (Array.isArray(experiment?.activityNames) && experiment.activityNames.length > 0) {
      sanitized.activityNames = experiment.activityNames;
    }

    if (Array.isArray(experiment?.activityIds) && experiment.activityIds.length > 0) {
      sanitized.activityIds = experiment.activityIds;
    }

    return sanitized;
  });
}

function sanitizeTopUrlResult(result = {}) {
  const sanitized = {
    url: result.url,
    category: result.category,
    priority: result.priority,
    success: !!result.success,
    isSeedUrl: !!result.isSeedUrl,
    adobeTargetDetected: !!result.adobeTargetDetected,
    experimentCount: result.experimentCount || 0,
    experiments: sanitizeExperiments(result.experiments),
    version: result.version,
    activityNames: Array.isArray(result.activityNames) ? result.activityNames : [],
    activityIds: Array.isArray(result.activityIds) ? result.activityIds : [],
    scrapedAt: result.scrapedAt
  };

  if (result.error) {
    sanitized.error = result.error;
  }

  if (!sanitized.version) {
    delete sanitized.version;
  }

  if (!sanitized.scrapedAt) {
    delete sanitized.scrapedAt;
  }

  return sanitized;
}

function buildSummary(summary = {}, topUrlResults = []) {
  const uniqueExperimentIds = new Set(
    Array.isArray(summary?.uniqueExperimentIds) ? summary.uniqueExperimentIds : []
  );
  const uniqueActivityIds = new Set(
    Array.isArray(summary?.uniqueActivityIds) ? summary.uniqueActivityIds : []
  );
  const uniqueExperimentNames = new Set(
    Array.isArray(summary?.uniqueExperimentNames) ? summary.uniqueExperimentNames : []
  );
  const allActivityIds = Array.isArray(summary?.allActivityIds)
    ? [...summary.allActivityIds]
    : [];

  topUrlResults.forEach(result => {
    (result.activityIds || []).forEach(id => {
      if (!id) {
        return;
      }
      uniqueActivityIds.add(id);
      allActivityIds.push(id);
    });

    (result.experiments || []).forEach(exp => {
      if (exp.experimentId) {
        uniqueExperimentIds.add(exp.experimentId);
      }
      if (Array.isArray(exp.activityIds)) {
        exp.activityIds.forEach(id => {
          if (!id) {
            return;
          }
          uniqueActivityIds.add(id);
          allActivityIds.push(id);
        });
      }
      if (exp.experimentName) {
        uniqueExperimentNames.add(exp.experimentName);
      }
    });
  });

  const finalSummary = {
    ...(summary || {}),
    uniqueExperimentIds: Array.from(uniqueExperimentIds),
    uniqueExperimentCount: uniqueExperimentIds.size,
    uniqueActivityIds: Array.from(uniqueActivityIds),
    uniqueActivityCount: uniqueActivityIds.size,
    uniqueExperimentNames: Array.from(uniqueExperimentNames),
    allActivityIds,
    allActivityCount: allActivityIds.length
  };

  return finalSummary;
}

function sanitizeWorkflowResult(workflow = {}) {
  const topResults = Array.isArray(workflow.topUrlsScrapingResults)
    ? workflow.topUrlsScrapingResults.map(sanitizeTopUrlResult)
    : [];
  const sanitized = {
    originalUrl: workflow.originalUrl,
    topUrlsScrapingResults: topResults,
    status: workflow.status || 'pending',
    completedAt: workflow.completedAt
  };

  const hasSummaryInput = workflow.summary && typeof workflow.summary === 'object';
  if (hasSummaryInput || topResults.length > 0) {
    sanitized.summary = buildSummary(workflow.summary || {}, topResults);
  }

  if (workflow.error) {
    sanitized.error = workflow.error;
  }

  if (!sanitized.completedAt) {
    delete sanitized.completedAt;
  }

  return sanitized;
}

function sanitizeAdobeTargetDocument(doc) {
  if (!doc) {
    return doc;
  }

  const plainDoc = typeof doc.toObject === 'function'
    ? doc.toObject({ depopulate: true })
    : { ...doc };

  return {
    ...plainDoc,
    urlWorkflowResults: Array.isArray(plainDoc.urlWorkflowResults)
      ? plainDoc.urlWorkflowResults.map(sanitizeWorkflowResult)
      : []
  };
}

module.exports = {
  sanitizeAdobeTargetDocument,
  sanitizeTopUrlResult,
  sanitizeWorkflowResult
};

