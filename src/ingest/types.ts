export interface RawPage {
  /** http(s) URL for crawled pages, or a repo-relative path for local files. */
  url: string;
  title: string;
  text: string;
}

export interface Chunk {
  id: number;
  url: string;
  title: string;
  /** Heading trail inside the page, e.g. "Install > Windows". */
  section: string;
  text: string;
}
