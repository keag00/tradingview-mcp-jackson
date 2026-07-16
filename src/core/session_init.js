/**
 * Session-start automation: makes sure the custom ICT Concepts + Doji Scanner
 * indicator is actually on the chart, the chart is on the right symbol, and
 * the cloud-saved script matches what's checked into the repo — so none of
 * that has to be re-done by hand at the start of every TradingView session.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as health from './health.js';
import * as chart from './chart.js';
import * as pine from './pine.js';
import { loadRules } from './morning.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../../');
const INDICATOR_NAME = 'ICT Concepts + Doji Scanner [Keagan]';
const INDICATOR_FILE = join(PROJECT_ROOT, 'indicators', 'ict-concepts-doji-scanner.pine');
const FALLBACK_SYMBOL = 'OANDA:GBPUSD';

function expectedSymbol() {
  try {
    const { rules } = loadRules();
    return rules?.watchlist?.[0] || FALLBACK_SYMBOL;
  } catch {
    return FALLBACK_SYMBOL;
  }
}

export async function ensureIndicators({ symbol, dry_run = false } = {}) {
  const targetSymbol = symbol || expectedSymbol();
  const steps = [];

  // 1. Connection check — everything else needs this.
  let healthResult;
  try {
    healthResult = await health.healthCheck();
  } catch (err) {
    return {
      success: false,
      steps: [{ step: 'connection', ok: false, error: err.message }],
      error: 'Could not reach TradingView via CDP. Is TradingView Desktop open with --remote-debugging-port=9222? Try tv_launch.',
    };
  }
  steps.push({ step: 'connection', ok: true, target_url: healthResult.target_url });

  if (!healthResult.api_available) {
    steps.push({ step: 'chart_api', ok: false, error: 'Chart API not available — no chart open in the connected tab?' });
    return { success: false, steps };
  }

  // 2. Symbol re-assertion — TradingView Desktop has a known bug where the
  // symbol can silently revert to a previous one across a relaunch.
  const symbolStep = { step: 'symbol', expected: targetSymbol, was: healthResult.chart_symbol };
  if (healthResult.chart_symbol !== targetSymbol) {
    if (dry_run) {
      symbolStep.action = 'would_set';
    } else {
      try {
        await chart.setSymbol({ symbol: targetSymbol });
        symbolStep.action = 'set';
      } catch (err) {
        symbolStep.action = 'error';
        symbolStep.error = err.message;
      }
    }
  } else {
    symbolStep.action = 'none';
  }
  steps.push(symbolStep);

  // 3. Indicator presence — add it if it's missing from the chart.
  const state = await chart.getState();
  const nameLc = INDICATOR_NAME.toLowerCase();
  const present = (state.studies || []).some(
    (s) => (s.name || '').toLowerCase() === nameLc || (s.name || '').toLowerCase().includes('ict concepts'),
  );
  const indicatorStep = { step: 'indicator_presence', name: INDICATOR_NAME, present };
  if (!present) {
    if (dry_run) {
      indicatorStep.action = 'would_add';
    } else {
      try {
        const res = await chart.manageIndicator({ action: 'add', indicator: INDICATOR_NAME });
        indicatorStep.action = res.success ? 'added' : 'add_failed';
        indicatorStep.result = res;
      } catch (err) {
        indicatorStep.action = 'error';
        indicatorStep.error = err.message;
      }
    }
  } else {
    indicatorStep.action = 'none';
  }
  steps.push(indicatorStep);

  // 4. Drift check — compare the repo's checked-in source against whatever's
  // actually saved in TradingView's cloud, and push the repo version if
  // they've diverged. Read-only lookup first (no Pine Editor UI involved);
  // the push (if needed) does have to go through the fragile Monaco path.
  const driftStep = { step: 'drift_check', name: INDICATOR_NAME };
  try {
    const repoSource = readFileSync(INDICATOR_FILE, 'utf-8');
    const saved = await pine.getSavedSource({ name: INDICATOR_NAME });
    if (!saved.found) {
      driftStep.status = 'not_found_in_cloud';
    } else if (saved.source.trim() === repoSource.trim()) {
      driftStep.status = 'in_sync';
    } else {
      driftStep.status = 'drifted';
      driftStep.repo_chars = repoSource.length;
      driftStep.cloud_chars = saved.source.length;
      if (dry_run) {
        driftStep.action = 'would_push';
      } else {
        try {
          await pine.openScript({ name: INDICATOR_NAME });
          await pine.setSource({ source: repoSource });
          const compileResult = await pine.smartCompile();
          driftStep.compile_result = { has_errors: compileResult.has_errors, errors: compileResult.errors };
          if (!compileResult.has_errors) {
            await pine.save();
            driftStep.action = 'pushed';
          } else {
            driftStep.action = 'push_aborted_compile_errors';
          }
        } catch (err) {
          driftStep.action = 'push_failed';
          driftStep.error = err.message;
        }
      }
    }
  } catch (err) {
    driftStep.status = 'error';
    driftStep.error = err.message;
  }
  steps.push(driftStep);

  const hasError = steps.some((s) => s.action === 'error' || s.status === 'error');
  return { success: !hasError, symbol: targetSymbol, steps };
}
