import { readFileSync } from "fs";
import { join } from "path";

function serveHTML(fileName: string) {
  const filePath = join(process.cwd(), "src/html", fileName);
  const html = readFileSync(filePath, "utf8");
  return html;
}

export { serveHTML };
