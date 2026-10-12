/** Simple backpressure / budget controller for collectors */
class Budget {
  constructor() {
    this.queueDepth = 0;
    this.eventsToday = 0;
    this.degraded = false;
    this.lastCpuCheck = 0;
    this.skipScreenshot = false;
    this.skipUia = false;
    this.skipOcr = false;
  }
  onEnqueue(n = 1) {
    this.queueDepth += n;
    this.eventsToday += n;
    if (this.queueDepth > 200) {
      this.degraded = true;
      this.skipOcr = true;
      this.skipUia = true;
    }
    if (this.queueDepth > 500) {
      this.skipScreenshot = true;
    }
  }
  onFlush(n = 1) {
    this.queueDepth = Math.max(0, this.queueDepth - n);
    if (this.queueDepth < 50) {
      this.degraded = false;
      this.skipScreenshot = false;
      this.skipUia = false;
      this.skipOcr = false;
    }
  }
  snapshot() {
    return {
      queueDepth: this.queueDepth,
      eventsToday: this.eventsToday,
      degraded: this.degraded,
      skipScreenshot: this.skipScreenshot,
      skipUia: this.skipUia,
      skipOcr: this.skipOcr
    };
  }
}
module.exports = { Budget };
