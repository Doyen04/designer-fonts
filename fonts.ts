import fs from 'fs';
import path from 'path';
import https from 'https';
import { HttpsProxyAgent } from 'https-proxy-agent';

const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || 'http://172.27.192.151:8080';
const agent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : undefined;

console.log(proxyUrl, agent);

function downloadFile(url: string, destPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        https
            .get(url, { agent }, (res) => {
                if (res.statusCode !== 200) {
                    return reject(new Error(`Failed: ${url} - ${res.statusCode}`));
                }
                const fileStream = fs.createWriteStream(destPath);
                res.pipe(fileStream);
                fileStream.on('finish', () => fileStream.close(resolve));
            })
            .on('error', reject);
    });
}

function fetchCSS(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
        https
            .get(url, { agent }, (res) => {
                if (res.statusCode !== 200) {
                    console.error(`⨯ Failed to fetch CSS from ${url}: ${res.statusCode}`);
                    return reject(new Error(`Failed to fetch CSS: ${res.statusCode}`));
                }

                console.log(`✓ Fetching CSS from ${url}`);
                let data = '';
                res.on('data', (chunk) => (data += chunk));
                res.on('end', () => {
                    console.log(`✓ CSS fetched successfully (${data.length} bytes)`);
                    resolve(data);
                });
            })
            .on('error', (err) => {
                console.error(`⨯ Network error fetching ${url}:`, err.message);
                reject(err);
            });
    });
}

function extractFontUrls(css: string): string[] {
    const urlRegex = /url\((https:\/\/[^)]+\.(?:woff2?|ttf|otf))\)/g;
    const urls: string[] = [];
    let match;

    while ((match = urlRegex.exec(css)) !== null) {
        urls.push(match[1]);
    }

    return urls;
}

function writeFontUrlsToJson(fontUrls: Record<string, string[]>, filePath: string) {
    const jsonData = JSON.stringify(fontUrls, null, 2);
    fs.writeFileSync(filePath, jsonData, 'utf8');
    console.log(`✓ Font URLs written to ${filePath}`);
}

async function downloadFonts(fonts: Record<string, string[]>, outDir = './downloaded-fonts') {
    fs.mkdirSync(outDir, { recursive: true });

    const allFontUrls: Record<string, string[]> = {};

    const tasks: Promise<void>[] = [];
    for (const [fontName, cssUrls] of Object.entries(fonts)) {
        const fontDir = path.join(outDir, fontName.replace(/\s+/g, '-'));
        fs.mkdirSync(fontDir, { recursive: true });

        for (const cssUrl of cssUrls) {
            tasks.push(
                (async () => {
                    try {
                        console.log(`Processing ${fontName}...`);

                        const css = await fetchCSS(cssUrl);

                        // Extract font file URLs from CSS
                        const fontUrls = extractFontUrls(css);

                        if (fontUrls.length === 0) {
                            console.log(`⚠ No font files found for ${fontName}`);
                            return;
                        }

                        allFontUrls[fontName] = fontUrls;

                        // Download each font file - wrap each in try/catch
                        const fontTasks = fontUrls.map(async (fontUrl, index) => {
                            try {
                                let extension = '.woff2'; // default
                                if (fontUrl.includes('.ttf')) extension = '.ttf';
                                else if (fontUrl.includes('.woff2')) extension = '.woff2';
                                else if (fontUrl.includes('.woff')) extension = '.woff';
                                else if (fontUrl.includes('.otf')) extension = '.otf';

                                const filename = `${fontName.replace(/\s+/g, '-')}-${index}${extension}`;
                                const dest = path.join(fontDir, filename);

                                await downloadFile(fontUrl, dest);
                                console.log(`✓ Downloaded ${fontName} → ${filename}`);
                            } catch (err) {
                                console.error(`⨯ Failed to download ${fontName} file ${index}: ${err.message}`);
                            }
                        });

                        const res = await Promise.allSettled(fontTasks);
                        const successful = res.filter((r) => r.status === 'fulfilled').length;
                        const failed = res.filter((r) => r.status === 'rejected').length;
                        console.log(`\n✓ Download complete: ${successful} successful, ${failed} failed`);
                        console.log(`✓ Completed processing ${fontName}`);
                    } catch (err) {
                        console.error(`⨯ Failed to process ${fontName}: ${err.message}`);
                    }
                })()
            );
        }
    }

    // Use Promise.allSettled instead of Promise.all
    const results = await Promise.allSettled(tasks);

    const urlsJsonPath = path.join('./', 'font-urls.json');
    const sortedFontUrls = Object.keys(allFontUrls)
        .sort()
        .reduce((sorted, key) => {
            sorted[key] = allFontUrls[key];
            return sorted;
        }, {} as Record<string, string[]>);

    writeFontUrlsToJson(sortedFontUrls, urlsJsonPath);

    const successful = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;

    console.log(`\n✓ Download complete: ${successful} successful, ${failed} failed`);
}

function loadFontsFromJson(filePath: string) {
    const jsonData = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(jsonData);

    const fonts: Record<string, string[]> = {};

    parsed.fonts.forEach((fontName: string) => {
        const googleFontName = fontName.replace(/\s+/g, '+');
        // Include common weights to get more font files
        const cssUrl = `https://fonts.googleapis.com/css2?family=${googleFontName}:wght@400;700&display=swap`;
        fonts[fontName] = [cssUrl];
    });

    return fonts;
}

const fontsJsonPath = path.join(__dirname, 'fonts.json');
const fonts = loadFontsFromJson(fontsJsonPath);

downloadFonts(fonts).catch(console.error);
