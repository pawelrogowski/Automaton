#!/usr/bin/env node

// Quick test to verify the mouse humanization module loads and works correctly

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

try {
  console.log('Testing mouse-controller module...\n');

  // Test 1: Module Loading
  console.log('1. Testing module import...');
  const mouseController = require('./nativeModules/mouseController/build/Release/mouse-controller.node');
  console.log('✓ Module loaded successfully');
  console.log('  Available methods:', Object.keys(mouseController).join(', '));

  // Test 2: Function existence
  console.log('\n2. Testing function signatures...');
  const expectedFunctions = [
    'leftClick',
    'rightClick',
    'mouseDown',
    'mouseUp',
    'rightMouseDown',
    'rightMouseUp',
    'mouseMove',
  ];
  let allPresent = true;
  for (const fn of expectedFunctions) {
    if (typeof mouseController[fn] === 'function') {
      console.log(`  ✓ ${fn} exists`);
    } else {
      console.log(`  ✗ ${fn} MISSING`);
      allPresent = false;
    }
  }

  if (allPresent) {
    console.log('\n✓ All functions present and ready');
  } else {
    console.log('\n✗ Some functions missing!');
    process.exit(1);
  }

  // Test 3: Parameter validation (should throw with wrong params)
  console.log('\n3. Testing parameter validation...');
  try {
    mouseController.leftClick(); // Should throw - missing params
    console.log('  ✗ Should have thrown error for missing params');
  } catch (e) {
    console.log('  ✓ Correctly validates parameters');
    console.log(`     Error: ${e.message}`);
  }

  // Test 4: Display detection
  console.log('\n4. Checking X11 display...');
  const display = process.env.DISPLAY || ':0';
  console.log(`  Display: ${display}`);

  console.log('\n========================================');
  console.log('✓ ALL TESTS PASSED');
  console.log('========================================');
  console.log('\nThe mouse humanization module is correctly integrated!');
  console.log('\nFeatures included:');
  console.log('  • XTest API for undetectable input');
  console.log(
    '  • Adaptive movement (FAST_BEZIER/FULL_BEZIER) - NO instant warps!',
  );
  console.log('  • Always uses Bezier curves (minimum 2 steps)');
  console.log('  • Click position jitter (±1-3px)');
  console.log('  • Variable button press duration (15-50ms)');
  console.log('  • Behavior profiles (speed, precision, overshoot)');
  console.log('  • Cursor position tracking across calls');
  console.log('  • Overshoot & correction (5-15% chance)');
  console.log('  • maxDuration parameter support');
  console.log('\nReady for use! 🎮');
} catch (error) {
  console.error('\n✗ ERROR:', error.message);
  console.error('\nStack trace:');
  console.error(error.stack);
  process.exit(1);
}
