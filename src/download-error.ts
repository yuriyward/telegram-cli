export class DownloadFailureError extends Error {
  readonly partial: string;

  constructor(partial: string, cause: Error) {
    super("Attachment download failed; partial file retained.", { cause });
    this.name = "DownloadFailureError";
    this.partial = partial;
  }
}
