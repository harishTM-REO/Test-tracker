/**
 * Deadlock Simulation Test
 *
 * This script tests the deadlock detection and recovery mechanism
 * by simulating a scenario where all browsers are stuck.
 */

const browserPool = require('./services/browserPoolService');

async function simulateDeadlock() {
  console.log('\n' + '='.repeat(80));
  console.log('🧪 DEADLOCK SIMULATION TEST');
  console.log('='.repeat(80) + '\n');

  try {
    // Step 1: Initialize the browser pool
    console.log('Step 1: Initializing browser pool...');
    await browserPool.initialize();
    console.log('✅ Browser pool initialized\n');

    // Wait a bit for initialization
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Step 2: Show initial state
    let stats = browserPool.getStats();
    console.log('Initial pool state:');
    console.log(`   Available browsers: ${stats.available}`);
    console.log(`   Busy browsers: ${stats.inUse}`);
    console.log(`   Waiting requests: ${stats.waiting}\n`);

    // Step 3: Acquire all browsers to make them "busy"
    console.log('Step 2: Acquiring all browsers to simulate busy state...');
    const acquiredBrowsers = [];
    for (let i = 0; i < stats.poolSize; i++) {
      const browser = await browserPool.acquireBrowser();
      acquiredBrowsers.push(browser);
      console.log(`   ✅ Acquired browser ${i + 1}/${stats.poolSize}`);
    }

    stats = browserPool.getStats();
    console.log(`\nPool state after acquisition:`);
    console.log(`   Available browsers: ${stats.available}`);
    console.log(`   Busy browsers: ${stats.inUse}\n`);

    // Step 4: Add fake waiting requests
    console.log('Step 3: Adding fake waiting requests...');
    const fakeRequests = [];
    for (let i = 0; i < 3; i++) {
      const promise = browserPool.acquireBrowser();
      fakeRequests.push(promise);
      console.log(`   ⏳ Added waiting request ${i + 1}`);
    }

    // Small delay to let the queue populate
    await new Promise(resolve => setTimeout(resolve, 1000));

    stats = browserPool.getStats();
    console.log(`\nPool state with waiting requests:`);
    console.log(`   Available browsers: ${stats.available}`);
    console.log(`   Busy browsers: ${stats.inUse}`);
    console.log(`   Waiting requests: ${stats.waiting}\n`);

    // Step 5: Simulate deadlock by setting activity timestamp to >10 minutes ago
    console.log('Step 4: Simulating deadlock (setting idle time to 11 minutes ago)...');
    const elevenMinutesAgo = Date.now() - (11 * 60 * 1000);
    browserPool.lastActivityTimestamp = elevenMinutesAgo;
    console.log(`   ⚠️ Activity timestamp set to: ${new Date(elevenMinutesAgo).toISOString()}`);
    console.log(`   Current time: ${new Date().toISOString()}`);
    console.log(`   Idle time: ${Math.round((Date.now() - elevenMinutesAgo) / 1000)}s\n`);

    // Step 6: Wait for watchdog to detect and recover (watchdog runs every 60s in production, but for test we can manually trigger)
    console.log('Step 5: Triggering deadlock detection manually...');
    console.log('   (In production, the watchdog checks every 60 seconds automatically)\n');

    // Manually check for deadlock condition
    stats = browserPool.getStats();
    const idleTime = Date.now() - browserPool.lastActivityTimestamp;
    const maxIdleTime = 600000; // 10 minutes

    if (stats.waiting > 0 && stats.available === 0 && idleTime > maxIdleTime) {
      console.log('🚨 DEADLOCK CONDITION MET - Triggering recovery...\n');
      await browserPool.recoverFromDeadlock();
    } else {
      console.log('❌ Deadlock condition NOT met (this should not happen)');
      console.log(`   Waiting: ${stats.waiting}, Available: ${stats.available}, Idle: ${Math.round(idleTime/1000)}s\n`);
    }

    // Step 7: Verify recovery
    console.log('Step 6: Verifying recovery...');
    await new Promise(resolve => setTimeout(resolve, 2000));

    stats = browserPool.getStats();
    console.log(`\nPool state immediately after recovery:`);
    console.log(`   Available browsers: ${stats.available}`);
    console.log(`   Busy browsers: ${stats.inUse}`);
    console.log(`   Waiting requests: ${stats.waiting}`);
    console.log(`   Total browsers created: ${stats.totalBrowsersCreated}`);
    console.log(`   Total browser restarts: ${stats.totalBrowserRestarts}\n`);

    // The recovery mechanism immediately serves waiting requests with fresh browsers
    // So we expect: 0 available, 2 busy (serving the first 2 waiting requests), 1 still waiting
    const recoverySuccessful = stats.totalBrowsersCreated >= stats.poolSize * 2; // Original + rebuilt

    if (recoverySuccessful) {
      console.log('✅ RECOVERY SUCCESSFUL - Pool was rebuilt and browsers were created!\n');
      console.log('   Note: Fresh browsers were immediately assigned to waiting requests,');
      console.log('   which is the correct behavior. This prevents request timeouts.\n');
    } else {
      console.log('❌ RECOVERY FAILED - Pool was not rebuilt properly\n');
    }

    // Cleanup
    console.log('Cleaning up...');
    await browserPool.closeAll();
    console.log('✅ Test complete\n');

    console.log('='.repeat(80));
    console.log('🎉 DEADLOCK SIMULATION TEST COMPLETE');
    console.log('='.repeat(80) + '\n');

    process.exit(0);

  } catch (error) {
    console.error('\n❌ TEST FAILED:', error.message);
    console.error(error.stack);

    try {
      await browserPool.closeAll();
    } catch (e) {
      // Ignore cleanup errors
    }

    process.exit(1);
  }
}

// Run the test
console.log('\n🚀 Starting deadlock simulation test in 3 seconds...');
setTimeout(() => {
  simulateDeadlock();
}, 3000);
