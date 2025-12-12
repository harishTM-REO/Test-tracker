const fs = require("fs");
const path = require("path");
let inspector;

try {
  inspector = require("inspector");
} catch (err) {
  inspector = null;
}

function takeHeapSnapshot(label = "") {
  return new Promise((resolve, reject) => {
    if (!inspector) {
      return reject(new Error("Inspector module not available. Enable Node with --inspect or --expose-gc."));
    }

    try {
      const session = new inspector.Session();
      session.connect();

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = path.join(
        process.cwd(),
        `heap-${label}-${timestamp}.heapsnapshot`
      );
      const fileStream = fs.createWriteStream(filename);

      session.on("HeapProfiler.addHeapSnapshotChunk", (m) => {
        fileStream.write(m.params.chunk);
      });

      session.post("HeapProfiler.takeHeapSnapshot", null, (err) => {
        if (err) return reject(err);
        fileStream.end();
        session.disconnect();
        console.log(`📸 Heap snapshot saved → ${filename}`);
        resolve(filename);
      });
    } catch (e) {
      reject(e);
    }
  });
}

module.exports = { takeHeapSnapshot };
