const ABTastyValidationDocument = require("../../models/ABTastyValidationDocument");

class BatchWriter {
  constructor() {
    this.buffers = {}; // { batchKey: { pos:[], neg:[], fail:[], count:0 } }
    this.FLUSH_SIZE = parseInt(process.env.DB_FLUSH_SIZE) || 50;
    this.FLUSH_INTERVAL = parseInt(process.env.DB_FLUSH_INTERVAL) || 3000;
    this.timer = null;
  }

  ensureBatch(batchKey) {
    if (!this.buffers[batchKey]) {
      this.buffers[batchKey] = { pos: [], neg: [], fail: [], count: 0 };
    }
  }

  async add(batchKey, type, record) {
    this.ensureBatch(batchKey);
    const buf = this.buffers[batchKey];

    if (type === "pos") buf.pos.push(record);
    else if (type === "neg") buf.neg.push(record);
    else buf.fail.push(record);

    buf.count++;

    if (buf.count >= this.FLUSH_SIZE) {
      await this.flush(batchKey);
    }

    if (!this.timer) {
      this.timer = setTimeout(() => this.flushAll(), this.FLUSH_INTERVAL);
    }
  }

  async flush(batchKey) {
    const buf = this.buffers[batchKey];
    if (!buf) return;

    const pos = buf.pos;
    const neg = buf.neg;
    const fail = buf.fail;

    if (pos.length + neg.length + fail.length === 0) return;

    await ABTastyValidationDocument.updateOne(
      { batchKey },
      {
        $setOnInsert: { batchKey, createdAt: new Date() },
        $push: {
          positiveUrls: { $each: pos },
          negativeUrls: { $each: neg },
          failedUrls: { $each: fail }
        },
        $inc: {
          positiveCount: pos.length,
          negativeCount: neg.length,
          failedCount: fail.length,
          totalUrls: pos.length + neg.length + fail.length
        }
      },
      { upsert: true }
    );

    buf.pos = [];
    buf.neg = [];
    buf.fail = [];
    buf.count = 0;
  }

  async flushAll() {
    const keys = Object.keys(this.buffers);
    for (const key of keys) {
      await this.flush(key);
    }
    clearTimeout(this.timer);
    this.timer = null;
  }
}

module.exports = new BatchWriter();
