#!/usr/bin/env node

/**
 * Native Module Performance Benchmarking Tool
 * 
 * Usage:
 *   node tools/benchmark_native_modules.js <module> [options]
 * 
 * Examples:
 *   node tools/benchmark_native_modules.js findSequences
 *   node tools/benchmark_native_modules.js findHealthBars --iterations 1000
 *   node tools/benchmark_native_modules.js all --frame /tmp/frame.raw
 */

const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');

// Module configurations
const MODULES = {
  findSequences: {
    path: './nativeModules/findSequences/build/Release/findSequences.node',
    testFunction: 'findSequencesNative',
    getTestParams: (frame, regions) => {
      // Test case from regionMonitor.js
      const sequences = {
        'health_bar_marker': {
          sequence: [[237, 62, 10]],
          direction: 'vertical'
        },
        'mana_bar_marker': {
          sequence: [[69, 92, 207]],
          direction: 'vertical'
        }
      };
      return [frame, sequences, regions.healthBar || { x: 100, y: 100, width: 100, height: 100 }];
    }
  },
  
  findHealthBars: {
    path: './nativeModules/findHealthBars/build/Release/findHealthBars.node',
    testFunction: 'findHealthBars',
    getTestParams: (frame, regions) => {
      return [frame, regions.gameWorld || { x: 284, y: 19, width: 1177, height: 834 }];
    }
  },
  
  findTarget: {
    path: './nativeModules/findTarget/build/Release/findTarget.node',
    testFunction: 'findTarget',
    getTestParams: (frame, regions) => {
      return [frame, regions.gameWorld || { x: 284, y: 19, width: 1177, height: 834 }];
    }
  },
  
  fontOcr: {
    path: './nativeModules/fontOcr/build/Release/fontOcr.node',
    testFunction: 'recognizeText',
    getTestParams: (frame, regions) => {
      const colors = [[255, 255, 255]];
      const allowedChars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ ';
      return [frame, regions.battleList || { x: 100, y: 100, width: 200, height: 300 }, colors, allowedChars];
    }
  },
  
  minimapMatcher: {
    path: './nativeModules/minimapMatcher/build/Release/minimapMatcher.node',
    testFunction: 'matchMinimap',
    getTestParams: (frame, regions) => {
      // Would need actual minimap template, skip for now
      return null;
    }
  }
};

// Default test frame
const DEFAULT_FRAME = '/tmp/hb_mismatch_1760002760077.raw';

// Parse command line arguments
const args = process.argv.slice(2);
const moduleName = args[0] || 'all';
const iterations = parseInt(args.find(a => a.startsWith('--iterations='))?.split('=')[1] || '100');
const framePath = args.find(a => a.startsWith('--frame='))?.split('=')[1] || DEFAULT_FRAME;
const warmup = parseInt(args.find(a => a.startsWith('--warmup='))?.split('=')[1] || '10');
const verbose = args.includes('--verbose') || args.includes('-v');

console.log('='.repeat(80));
console.log('NATIVE MODULE PERFORMANCE BENCHMARK');
console.log('='.repeat(80));
console.log(`Iterations: ${iterations}`);
console.log(`Warmup: ${warmup}`);
console.log(`Frame: ${framePath}`);
console.log('');

// Load test frame
if (!fs.existsSync(framePath)) {
  console.error(`❌ Frame file not found: ${framePath}`);
  console.error('Please provide a valid frame dump with --frame=path');
  process.exit(1);
}

const frameData = fs.readFileSync(framePath);
const width = frameData.readUInt32LE(0);
const height = frameData.readUInt32LE(4);

console.log(`Frame loaded: ${width}x${height} (${(frameData.length / 1024 / 1024).toFixed(2)} MB)`);
console.log('');

// Mock regions based on typical values
const mockRegions = {
  gameWorld: { x: 284, y: 19, width: 1177, height: 834 },
  battleList: { x: 1473, y: 19, width: 163, height: 834 },
  healthBar: { x: 284, y: 887, width: 94, height: 11 },
  manaBar: { x: 390, y: 887, width: 94, height: 11 }
};

/**
 * Run benchmark for a single module
 */
function benchmarkModule(name, config) {
  console.log('-'.repeat(80));
  console.log(`Module: ${name}`);
  console.log('-'.repeat(80));
  
  // Load module
  let module;
  try {
    const modulePath = path.join(__dirname, '..', config.path);
    module = require(modulePath);
  } catch (error) {
    console.log(`❌ Failed to load module: ${error.message}`);
    console.log('   Make sure the module is built with: node-gyp rebuild');
    return null;
  }
  
  const testFunction = module[config.testFunction];
  if (!testFunction) {
    console.log(`❌ Function ${config.testFunction} not found in module`);
    return null;
  }
  
  // Get test parameters
  const params = config.getTestParams(frameData, mockRegions);
  if (!params) {
    console.log(`⚠️  No test parameters available for ${name}`);
    return null;
  }
  
  console.log(`Function: ${config.testFunction}`);
  console.log(`Parameters: ${params.length} arguments`);
  console.log('');
  
  // Warmup
  if (verbose) console.log('Warming up...');
  for (let i = 0; i < warmup; i++) {
    try {
      testFunction(...params);
    } catch (error) {
      console.log(`❌ Warmup failed: ${error.message}`);
      return null;
    }
  }
  
  // Benchmark
  const timings = [];
  let result;
  
  if (verbose) console.log(`Running ${iterations} iterations...`);
  
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    try {
      result = testFunction(...params);
    } catch (error) {
      console.log(`❌ Benchmark failed at iteration ${i}: ${error.message}`);
      return null;
    }
    const duration = performance.now() - start;
    timings.push(duration);
    
    if (verbose && (i + 1) % 10 === 0) {
      process.stdout.write(`\r  Progress: ${i + 1}/${iterations}`);
    }
  }
  
  if (verbose) process.stdout.write('\n\n');
  
  // Calculate statistics
  timings.sort((a, b) => a - b);
  
  const stats = {
    min: timings[0],
    max: timings[timings.length - 1],
    mean: timings.reduce((a, b) => a + b, 0) / timings.length,
    median: timings[Math.floor(timings.length / 2)],
    p95: timings[Math.floor(timings.length * 0.95)],
    p99: timings[Math.floor(timings.length * 0.99)],
    stddev: 0
  };
  
  // Calculate standard deviation
  const variance = timings.reduce((sum, t) => sum + Math.pow(t - stats.mean, 2), 0) / timings.length;
  stats.stddev = Math.sqrt(variance);
  
  // Print results
  console.log('Results:');
  console.log(`  Iterations: ${iterations}`);
  console.log(`  Total time: ${(timings.reduce((a, b) => a + b, 0) / 1000).toFixed(2)}s`);
  console.log('');
  console.log('Performance Statistics:');
  console.log(`  Min:     ${stats.min.toFixed(3)} ms`);
  console.log(`  Max:     ${stats.max.toFixed(3)} ms`);
  console.log(`  Mean:    ${stats.mean.toFixed(3)} ms ± ${stats.stddev.toFixed(3)} ms`);
  console.log(`  Median:  ${stats.median.toFixed(3)} ms`);
  console.log(`  95th %:  ${stats.p95.toFixed(3)} ms`);
  console.log(`  99th %:  ${stats.p99.toFixed(3)} ms`);
  console.log('');
  
  // Throughput
  const fps = 1000 / stats.mean;
  console.log(`Throughput: ${fps.toFixed(1)} operations/sec`);
  console.log('');
  
  // Result info
  if (result !== null && result !== undefined) {
    if (Array.isArray(result)) {
      console.log(`Result: Array with ${result.length} items`);
    } else if (typeof result === 'object') {
      const keys = Object.keys(result);
      console.log(`Result: Object with keys: ${keys.slice(0, 5).join(', ')}${keys.length > 5 ? '...' : ''}`);
    } else {
      console.log(`Result: ${result}`);
    }
  }
  console.log('');
  
  return stats;
}

/**
 * Generate performance report
 */
function generateReport(results) {
  console.log('='.repeat(80));
  console.log('PERFORMANCE SUMMARY');
  console.log('='.repeat(80));
  console.log('');
  
  const modules = Object.keys(results).filter(k => results[k]);
  if (modules.length === 0) {
    console.log('No successful benchmarks to report.');
    return;
  }
  
  // Sort by mean time
  modules.sort((a, b) => results[a].mean - results[b].mean);
  
  console.log('Module Performance Ranking (fastest to slowest):');
  console.log('');
  
  modules.forEach((name, index) => {
    const stats = results[name];
    const bar = '█'.repeat(Math.ceil(stats.mean / 2));
    console.log(`${(index + 1).toString().padStart(2)}. ${name.padEnd(20)} ${stats.mean.toFixed(2).padStart(8)} ms ${bar}`);
  });
  
  console.log('');
  console.log('Performance Targets:');
  console.log('  🟢 Excellent: < 2ms   (60+ FPS capable)');
  console.log('  🟡 Good:      < 5ms   (good for real-time)');
  console.log('  🟠 Acceptable: < 10ms (acceptable)');
  console.log('  🔴 Slow:      > 10ms  (needs optimization)');
  console.log('');
  
  modules.forEach(name => {
    const stats = results[name];
    let status = '🔴';
    if (stats.mean < 2) status = '🟢';
    else if (stats.mean < 5) status = '🟡';
    else if (stats.mean < 10) status = '🟠';
    
    console.log(`${status} ${name}: ${stats.mean.toFixed(2)} ms`);
  });
  
  console.log('');
  
  // Frame budget analysis
  const fps60Budget = 16.67; // ms per frame at 60 FPS
  console.log(`Frame Budget Analysis (60 FPS = ${fps60Budget.toFixed(2)} ms/frame):`);
  console.log('');
  
  modules.forEach(name => {
    const stats = results[name];
    const percentage = (stats.mean / fps60Budget * 100).toFixed(1);
    const withinBudget = stats.mean < fps60Budget;
    
    console.log(`  ${name}:`);
    console.log(`    Mean: ${stats.mean.toFixed(2)} ms (${percentage}% of frame budget) ${withinBudget ? '✓' : '✗'}`);
    console.log(`    95th: ${stats.p95.toFixed(2)} ms (${(stats.p95 / fps60Budget * 100).toFixed(1)}% of frame budget) ${stats.p95 < fps60Budget ? '✓' : '✗'}`);
  });
  
  console.log('');
}

// Main execution
if (moduleName === 'all') {
  console.log('Benchmarking all modules...');
  console.log('');
  
  const results = {};
  for (const [name, config] of Object.entries(MODULES)) {
    results[name] = benchmarkModule(name, config);
  }
  
  generateReport(results);
} else {
  const config = MODULES[moduleName];
  if (!config) {
    console.error(`❌ Unknown module: ${moduleName}`);
    console.error('Available modules:', Object.keys(MODULES).join(', '));
    process.exit(1);
  }
  
  const result = benchmarkModule(moduleName, config);
  if (result) {
    generateReport({ [moduleName]: result });
  }
}

console.log('='.repeat(80));
console.log('Benchmark complete!');
console.log('');
console.log('Next steps:');
console.log('  1. Identify bottlenecks using --verbose flag');
console.log('  2. Profile with perf: perf record -g node tools/benchmark_native_modules.js <module>');
console.log('  3. Optimize hot paths in C++ code');
console.log('  4. Re-run benchmark to verify improvements');
console.log('='.repeat(80));
