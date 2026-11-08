import { load } from "cheerio";
const HOSTS = new Set(["www.cpsc.gov", "cpsc.gov", "www.saferproducts.gov"]);
export function officialURL(value: string, api = false) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !HOSTS.has(url.hostname) ||
    (!api && !["www.cpsc.gov", "cpsc.gov"].includes(url.hostname)) ||
    (!api && !url.pathname.startsWith("/Recalls/"))
  )
    throw new Error("SOURCE_URL_NOT_ALLOWED");
  return url;
}
export async function fetchOfficial(
  value: string,
  api = false,
): Promise<string> {
  let url = officialURL(value, api);
  const signal = AbortSignal.timeout(10000);
  for (let i = 0; i < 4; i++) {
    const response = await fetch(url, {
      signal,
      redirect: "manual",
      headers: {
        Accept: api ? "application/json" : "text/html",
        "User-Agent": "RecallReady/0.1 bounded hackathon prototype",
      },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("INVALID_SOURCE_REDIRECT");
      url = officialURL(new URL(location, url).href, api);
      continue;
    }
    if (!response.ok) throw new Error("SOURCE_UNAVAILABLE");
    if (Number(response.headers.get("content-length") ?? 0) > 1048576)
      throw new Error("SOURCE_TOO_LARGE");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("EMPTY_SOURCE");
    let count = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      count += value.byteLength;
      if (count > 1048576) {
        await reader.cancel();
        throw new Error("SOURCE_TOO_LARGE");
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  }
  throw new Error("TOO_MANY_REDIRECTS");
}
export function parseOfficialPage(html: string) {
  const $ = load(html);
  $(
    "script,style,nav,footer,.related-recalls,.recall-product__related-recalls,.recall-product__recalls-links,.recall-product__recalls-disaclaimer-info,.recall-product__choose-email,.share-links,.recall-product__footer",
  ).remove();
  const container = $("article").first().length
    ? $("article").first()
    : $("main").first();
  if (!container.length) throw new Error("SOURCE_ARTICLE_NOT_FOUND");
  const output: string[] = [];
  const officialArticle = $("#recall-product-node");
  const add = (value: string) => {
    const normalized = value.replace(/\s+/g, " ").trim();
    if (normalized && !output.includes(normalized)) output.push(normalized);
  };
  if (officialArticle.length) {
    add($("h1").first().text());
    officialArticle
      .find(
        ".recall-product__info .view-rows,.recall-product__consumer-contact,.recall-product__details .view-rows",
      )
      .each((_, el) => add($(el).text()));
    officialArticle
      .find("figcaption,img[alt]")
      .each((_, el) => add($(el).attr("alt") ?? $(el).text()));
    const text = output.join("\n\n").normalize("NFC");
    if (
      text.length < 200 ||
      !text.includes("PB0003") ||
      !text.includes("Recall number")
    )
      throw new Error("SOURCE_PARSER_REQUIRES_REVIEW");
    return text;
  }
  container
    .find(
      "h1,h2,h3,p,figcaption,.field__label,.field--label-inline .field__item",
    )
    .each((_, el) => {
      const value = $(el).text().replace(/\s+/g, " ").trim();
      if (value && !output.includes(value)) output.push(value);
    });
  // Include alt captions: model disagreements are material evidence.
  container.find("img[alt]").each((_, el) => {
    const alt = $(el).attr("alt")?.trim();
    if (alt && !output.includes(alt)) output.push(alt);
  });
  const text = output.join("\n\n").replace(/\r\n/g, "\n").normalize("NFC");
  if (text.length < 200 || !/recall/i.test(text) || !/PB0003/.test(text))
    throw new Error("SOURCE_PARSER_REQUIRES_REVIEW");
  return text;
}
