export class UptimeClock {
  private startTime: number;
  private intervalId: NodeJS.Timer | null = null;
  private currentTime: string = "00:00:00";

  constructor() {
    this.startTime = Date.now();
    this.start();
  }

  public start() {
    this.intervalId = setInterval(() => {
      this.displayUptime();
    }, 1000);
  }

  public stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  // Method to calculate and display the uptime
  private displayUptime() {
    const elapsed = Date.now() - this.startTime;
    const hours = Math.floor(elapsed / (1000 * 60 * 60)); // Hours
    const minutes = Math.floor((elapsed % (1000 * 60 * 60)) / (1000 * 60)); // Minutes
    const seconds = Math.floor((elapsed % (1000 * 60)) / 1000); // Seconds

    this.currentTime = `${hours}:${minutes}:${seconds}`;
  }

  public getUptime() {
    return this.currentTime;
  }
}
