/**
 * Reads processes.nix + services.nix and provides process definitions.
 * Also generates process-compose.generated.yaml (kept for reference / fallback).
 * Never edit the generated file — edit the .nix sources instead.
 */
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
// ── Nix parser ─────────────────────────────────────────────────────────────
/** Extract content between matching braces starting at `pos` */
function extractBlock(src, pos) {
    let depth = 0, start = -1;
    for (let i = pos; i < src.length; i++) {
        if (src[i] === '{') {
            depth++;
            if (start === -1)
                start = i;
        }
        else if (src[i] === '}') {
            depth--;
            if (depth === 0)
                return src.slice(start + 1, i);
        }
    }
    return '';
}
function strAttr(block, name) {
    const m = block.match(new RegExp(`${name}\\s*=\\s*"([^"]+)"`));
    return m ? m[1] : undefined;
}
function nixStr(block, name) {
    const re = new RegExp(`${name}\\s*=\\s*''([\\s\\S]*?)''`);
    const m = block.match(re);
    return m ? m[1].trim() : undefined;
}
function parseDependsOn(block) {
    const depIdx = block.indexOf('depends_on');
    if (depIdx === -1)
        return {};
    const depBlock = extractBlock(block, depIdx);
    const result = {};
    const re = /([\w-]+)\s*=\s*\{[^}]*condition\s*=\s*"([^"]+)"/g;
    let m;
    while ((m = re.exec(depBlock)) !== null)
        result[m[1]] = m[2];
    return result;
}
function parseHealthCheck(block) {
    const idx = block.indexOf('readiness_probe');
    if (idx === -1)
        return undefined;
    const pb = extractBlock(block, idx);
    const initial_delay = Number(pb.match(/initial_delay_seconds\s*=\s*(\d+)/)?.[1] ?? 0) || undefined;
    const period = Number(pb.match(/period_seconds\s*=\s*(\d+)/)?.[1] ?? 0) || undefined;
    const failure = Number(pb.match(/failure_threshold\s*=\s*(\d+)/)?.[1] ?? 0) || undefined;
    const httpIdx = pb.indexOf('http_get');
    if (httpIdx !== -1) {
        const hb = extractBlock(pb, httpIdx);
        return {
            type: 'http',
            host: strAttr(hb, 'host') ?? 'localhost',
            port: Number(hb.match(/port\s*=\s*(\d+)/)?.[1] ?? 0),
            path: strAttr(hb, 'path') ?? '/',
            initial_delay_seconds: initial_delay,
            period_seconds: period,
            failure_threshold: failure,
        };
    }
    const execIdx = pb.indexOf('exec');
    if (execIdx !== -1) {
        const eb = extractBlock(pb, execIdx);
        return { type: 'exec', command: strAttr(eb, 'command'), initial_delay_seconds: initial_delay, period_seconds: period, failure_threshold: failure };
    }
    return undefined;
}
function parseProcessesNix(content) {
    const result = [];
    const procIdx = content.indexOf('processes =');
    if (procIdx === -1)
        return result;
    const procBlock = extractBlock(content, procIdx);
    // Split top-level entries by finding `name = {` only at indent level 4
    // (directly inside `processes = { ... }`)
    const lines = procBlock.split('\n');
    const entries = [];
    for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(/^    ([\w][\w-]*)\s*=\s*\{/);
        if (m && !lines[i].trimStart().startsWith('#')) {
            entries.push({ name: m[1], startLine: i });
        }
    }
    for (let ei = 0; ei < entries.length; ei++) {
        const { name, startLine } = entries[ei];
        const endLine = ei + 1 < entries.length ? entries[ei + 1].startLine : lines.length;
        const body = lines.slice(startLine, endLine).join('\n');
        const exec = nixStr(body, 'exec');
        if (!exec)
            continue;
        // Find process-compose block inside body
        const pcMatch = body.match(/process-compose\s*=\s*\{/);
        const pcBlock = pcMatch ? extractBlock(body, pcMatch.index) : '';
        result.push({
            name,
            exec,
            working_dir: strAttr(pcBlock, 'working_dir'),
            depends_on: parseDependsOn(pcBlock),
            health_check: parseHealthCheck(pcBlock),
        });
    }
    return result;
}
// ── Public API ─────────────────────────────────────────────────────────────
export function getProcessDefs(projectDir, infra = []) {
    const nixContent = readFileSync(join(projectDir, 'processes.nix'), 'utf-8');
    const fromNix = parseProcessesNix(nixContent);
    const fromInfra = infra.map(i => ({
        name: i.name,
        exec: i.exec,
        working_dir: i.working_dir,
        depends_on: i.depends_on ?? {},
        health_check: i.health_check,
        brew: i.brew,
    }));
    return [...fromInfra, ...fromNix];
}
export function needsRegen(opts) {
    const { projectDir, outputPath } = opts;
    if (!existsSync(outputPath))
        return true;
    const outMtime = statSync(outputPath).mtimeMs;
    for (const f of ['processes.nix', 'services.nix']) {
        const src = join(projectDir, f);
        if (existsSync(src) && statSync(src).mtimeMs > outMtime)
            return true;
    }
    return false;
}
export function generate(opts) {
    const { projectDir, outputPath, infra } = opts;
    const defs = getProcessDefs(projectDir, infra);
    const lines = ['version: "0.5"', 'processes:'];
    for (const def of defs) {
        lines.push(`  ${def.name}:`);
        lines.push(`    command: >-`);
        lines.push(`      sh -c ${JSON.stringify(def.exec)}`);
        if (def.working_dir)
            lines.push(`    working_dir: ${join(projectDir, def.working_dir)}`);
        if (Object.keys(def.depends_on).length) {
            lines.push(`    depends_on:`);
            for (const [dep, cond] of Object.entries(def.depends_on)) {
                lines.push(`      ${dep}:`);
                lines.push(`        condition: ${cond}`);
            }
        }
        lines.push('');
    }
    writeFileSync(outputPath, lines.join('\n'), 'utf-8');
}
