#!/bin/bash

# PGO Workflow Helper for findSequences Native Module
# This script helps manage the Profile-Guided Optimization process

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PGO_DIR="$SCRIPT_DIR/pgo-data"

case "$1" in
    "phase1"|"gather")
        echo "======================================================================"
        echo "PGO PHASE 1: Data Gathering Mode"
        echo "======================================================================"
        echo ""
        echo "Cleaning old PGO data..."
        rm -rf "$PGO_DIR"
        mkdir -p "$PGO_DIR"
        
        echo "Rebuilding with instrumentation..."
        node-gyp rebuild
        
        echo ""
        echo "✅ Module built with instrumentation"
        echo ""
        echo "📋 Next steps:"
        echo "   1. Run: npm run start (from project root)"
        echo "   2. Use the application normally for 5-10 minutes"
        echo "   3. Exercise all common use cases (login, combat, navigation, etc.)"
        echo "   4. Close the application"
        echo "   5. Run: ./pgo-workflow.sh phase2"
        echo ""
        echo "💡 Tip: The longer and more diverse your usage, the better"
        echo "        the optimization will be!"
        ;;
        
    "phase2"|"optimize")
        echo "======================================================================"
        echo "PGO PHASE 2: Optimization Mode"
        echo "======================================================================"
        echo ""
        
        # Check if profile data exists
        if [ ! -d "$PGO_DIR" ] || [ -z "$(ls -A $PGO_DIR/*.gcda 2>/dev/null)" ]; then
            echo "❌ ERROR: No profile data found!"
            echo ""
            echo "Please run phase1 first and use the application to generate data."
            exit 1
        fi
        
        # Count profile files
        PROFILE_COUNT=$(ls -1 "$PGO_DIR"/*.gcda 2>/dev/null | wc -l)
        echo "Found $PROFILE_COUNT profile data files"
        echo ""
        
        # Switch to use mode in binding.gyp
        echo "Switching to profile-use mode..."
        sed -i 's/# PGO Phase 1/## PGO Phase 1/g' binding.gyp
        sed -i 's/"-fprofile-generate"/#"-fprofile-generate"/g' binding.gyp
        sed -i 's/#"-fprofile-use"/"-fprofile-use"/g' binding.gyp
        sed -i 's/#"-fprofile-correction"/"-fprofile-correction"/g' binding.gyp
        sed -i 's/#"-Wno-error=coverage-mismatch"/"-Wno-error=coverage-mismatch"/g' binding.gyp
        
        # Update ldflags too
        sed -i 's/"-fprofile-generate",/#"-fprofile-generate",/g' binding.gyp
        
        echo "Rebuilding with profile-guided optimizations..."
        node-gyp rebuild
        
        echo ""
        echo "✅ Module optimized with PGO!"
        echo ""
        echo "📊 You can now benchmark with:"
        echo "   cd ../../ && node tools/benchmark_native_modules.cjs findSequences --iterations=100000"
        ;;
        
    "status")
        echo "======================================================================"
        echo "PGO Status"
        echo "======================================================================"
        echo ""
        
        if [ -d "$PGO_DIR" ] && [ -n "$(ls -A $PGO_DIR/*.gcda 2>/dev/null)" ]; then
            PROFILE_COUNT=$(ls -1 "$PGO_DIR"/*.gcda 2>/dev/null | wc -l)
            TOTAL_SIZE=$(du -sh "$PGO_DIR" 2>/dev/null | cut -f1)
            echo "✅ Profile data exists"
            echo "   Files: $PROFILE_COUNT"
            echo "   Size: $TOTAL_SIZE"
        else
            echo "❌ No profile data found"
        fi
        
        # Check current mode
        if grep -q '^\s*"-fprofile-generate"' binding.gyp 2>/dev/null; then
            echo "   Mode: INSTRUMENTATION (phase 1)"
        elif grep -q '^\s*"-fprofile-use"' binding.gyp 2>/dev/null; then
            echo "   Mode: OPTIMIZED (phase 2)"
        else
            echo "   Mode: UNKNOWN"
        fi
        ;;
        
    *)
        echo "PGO Workflow Helper for findSequences"
        echo ""
        echo "Usage: $0 {phase1|phase2|status}"
        echo ""
        echo "Commands:"
        echo "  phase1  - Start PGO data gathering (build with instrumentation)"
        echo "  phase2  - Apply PGO optimizations (build with profile data)"
        echo "  status  - Check current PGO status"
        echo ""
        echo "Full workflow:"
        echo "  1. ./pgo-workflow.sh phase1"
        echo "  2. npm run start (use app for 5-10 minutes)"
        echo "  3. ./pgo-workflow.sh phase2"
        exit 1
        ;;
esac
