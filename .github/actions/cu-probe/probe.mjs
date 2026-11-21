// Probe how the Microsoft cumulative update pages answer different HTTP clients from a GitHub runner, directly and
// through a local CONNECT proxy. This runs as a node24 action, so it uses the same Node.js as setup-sqlserver.
import { spawn } from 'node:child_process';
import { appendFile, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

const workspace = process.env.GITHUB_WORKSPACE;
const require = createRequire(`${workspace}/package.json`);
const httpClientDir = `${workspace}/node_modules/@actions/http-client`;
const { HttpClient } = await import(pathToFileURL(`${httpClientDir}/lib/index.js`).href);
const httpClientVersion = JSON.parse(await readFile(`${httpClientDir}/package.json`, 'utf8')).version;
const { EnvHttpProxyAgent } = require('undici');

// CU_PROBE_PAGES replaces the pages, for a local test of the probe itself
const PAGES = process.env.CU_PROBE_PAGES ? JSON.parse(process.env.CU_PROBE_PAGES) : {
    2025: 'https://www.microsoft.com/en-us/download/details.aspx?id=108788',
    2022: 'https://www.microsoft.com/en-us/download/details.aspx?id=105013',
    2019: 'https://www.microsoft.com/en-us/download/details.aspx?id=100809',
    2017: 'https://www.microsoft.com/en-us/download/details.aspx?id=56128',
};
const LINK = /https:\/\/download\.microsoft\.com\/[^"'\s<>]+\.exe/i;

// a minimal CONNECT proxy that records the hosts that it tunnels to
const tunnels = [];
const proxy = createServer((req, res) => {
    tunnels.push(`plain ${req.url}`);
    res.writeHead(502).end();
});
proxy.on('connect', (req, socket, head) => {
    tunnels.push(req.url);
    const [host, port] = req.url.split(':');
    const upstream = connect(Number(port) || 443, host, () => {
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        upstream.write(head);
        upstream.pipe(socket);
        socket.pipe(upstream);
    });
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
});
await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
const proxyUrl = `http://127.0.0.1:${proxy.address().port}`;

function describe(status, body) {
    return { status, link: LINK.test(body) };
}

async function viaFetch(url, options = {}) {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000), ...options });
    return describe(res.status, await res.text());
}

async function viaHttpClient(url, userAgent) {
    const res = await new HttpClient(userAgent).get(url);
    return describe(res.message.statusCode, await res.readBody());
}

// run a fetch in a child process with its own environment, while this process keeps the proxy running
function viaChild(url, env, setAtRuntime) {
    const script = `
        ${setAtRuntime ? `process.env.NODE_USE_ENV_PROXY = '1'; process.env.HTTPS_PROXY = ${JSON.stringify(proxyUrl)};` : ''}
        const res = await fetch(${JSON.stringify(url)}, { signal: AbortSignal.timeout(30_000) });
        const body = await res.text();
        console.log(JSON.stringify({ status: res.status, link: ${LINK}.test(body) }));
    `;
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
            env: { ...process.env, NO_PROXY: '', no_proxy: '', ...env },
        });
        let out = '';
        let err = '';
        child.stdout.on('data', (data) => { out += data; });
        child.stderr.on('data', (data) => { err += data; });
        child.on('error', reject);
        child.on('close', (code) => {
            try {
                resolve(JSON.parse(out.trim().split('\n').pop()));
            } catch {
                reject(new Error(`child exited with ${code}: ${err.trim() || out.trim()}`));
            }
        });
    });
}

async function withProxyEnv(fn) {
    const saved = { HTTPS_PROXY: process.env.HTTPS_PROXY, NO_PROXY: process.env.NO_PROXY, no_proxy: process.env.no_proxy };
    process.env.HTTPS_PROXY = proxyUrl;
    process.env.NO_PROXY = '';
    process.env.no_proxy = '';
    try {
        return await fn();
    } finally {
        for (const [name, value] of Object.entries(saved)) {
            if (value === undefined) {
                delete process.env[name];
            } else {
                process.env[name] = value;
            }
        }
    }
}

const probes = [];
for (const [version, url] of Object.entries(process.env.CU_PROBE_ALL ? PAGES : {})) {
    probes.push([version, 'native fetch', () => viaFetch(url)]);
    probes.push([version, 'http-client (default user agent)', () => viaHttpClient(url)]);
    probes.push([version, 'http-client (user agent "node")', () => viaHttpClient(url, 'node')]);
}
const url = PAGES[2022] ?? Object.values(PAGES)[0];
probes.push(['2022', 'native fetch + undici EnvHttpProxyAgent', () => withProxyEnv(() => viaFetch(url, { dispatcher: new EnvHttpProxyAgent() }))]);
probes.push(['2022', 'native fetch, NODE_USE_ENV_PROXY=1 at start', () => viaChild(url, { NODE_USE_ENV_PROXY: '1', HTTPS_PROXY: proxyUrl })]);
probes.push(['2022', 'native fetch, NODE_USE_ENV_PROXY set at runtime', () => viaChild(url, {}, true)]);
probes.push(['2022', 'native fetch, HTTPS_PROXY only', () => viaChild(url, { HTTPS_PROXY: proxyUrl })]);
probes.push(['2022', 'native fetch + http-client getAgentDispatcher + HTTPS_PROXY', () => withProxyEnv(() => {
    const dispatcher = new HttpClient('setup-sqlserver', [], { keepAlive: true }).getAgentDispatcher(url);
    return dispatcher ? viaFetch(url, { dispatcher }) : Promise.reject(new Error('no dispatcher'));
})]);
probes.push(['2022', 'native fetch + http-client getAgentDispatcher + NO_PROXY=www.microsoft.com', () => withProxyEnv(() => {
    process.env.NO_PROXY = 'www.microsoft.com';
    const dispatcher = new HttpClient('setup-sqlserver', [], { keepAlive: true }).getAgentDispatcher(url);
    return viaFetch(url, dispatcher ? { dispatcher } : {});
})]);
probes.push(['2022', 'http-client (default user agent) + HTTPS_PROXY', () => withProxyEnv(() => viaHttpClient(url))]);

const rows = [];
for (const [version, client, run] of probes) {
    const before = tunnels.length;
    let result;
    try {
        result = await run();
    } catch (error) {
        result = { status: 'error', link: false, error: error instanceof Error ? error.message : String(error) };
    }
    const tunnelled = tunnels.slice(before);
    rows.push({ version, client, ...result, proxy: tunnelled.length ? tunnelled.join(', ') : '-' });
    console.log(JSON.stringify(rows.at(-1)));
    await delay(2000);
}
proxy.close();

const header = [
    `Runner: ${process.env.ImageOS ?? '?'} ${process.env.ImageVersion ?? ''}, Node.js ${process.version}, undici ${process.versions.undici}, @actions/http-client ${httpClientVersion}`,
    '',
    '| Version | Client | Status | Link found | Proxy tunnels |',
    '| --- | --- | --- | --- | --- |',
];
const table = rows.map((r) => `| ${r.version} | ${r.client} | ${r.status}${r.error ? ` (${r.error})` : ''} | ${r.link ? 'yes' : 'no'} | ${r.proxy} |`);
const summary = [...header, ...table, ''].join('\n');
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
}
