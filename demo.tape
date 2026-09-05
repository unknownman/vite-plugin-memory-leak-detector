# demo.tape
# This is a fully self-contained demo built around an ALREADY-PREPARED project
# at /tmp/memory-leak-demo (deps installed, plugin configured, leaks planted).
# The visible recording focuses 100% on the plugin DX: build, detect, inspect,
# report, baseline, and a clean final run.
#
# Reproduce: prepare that project (see prepare-demo.sh), then launch VHS from /tmp:
#   cd /tmp && vhs /path/to/demo.tape

Output demo.gif

Require npm
Require node

Set Shell "bash"
Set Theme "Catppuccin Mocha"
Set FontFamily "Monaco"
Set FontSize 16
Set Width 1200
Set Height 800
Set Padding 32
Set Margin 24
Set MarginFill "#1e1e2e"
Set TypingSpeed 35ms
Set Framerate 45

# ---------------------------------------------------------------
# Silent setup: switch into the prepared project before recording
# ---------------------------------------------------------------
Hide
Type "cd /tmp/memory-leak-demo"
Enter
Sleep 400ms
Show

# ---------------------------------------------------------------
# SCENE 1 · Initial build & detection
# ---------------------------------------------------------------
Type "# Vite + React project · leaks planted in src/components/LeakyDashboard.tsx · the plugin is set to fail on any warning"
Enter
Sleep 900ms

Type "npm run build"
Enter
Sleep 6500ms

# ---------------------------------------------------------------
# SCENE 2 · Inspect the offending source
# ---------------------------------------------------------------
Ctrl+L

Type "# The same file - see exactly where each leak lives"
Enter
Sleep 500ms

Type "cat src/components/LeakyDashboard.tsx"
Enter
Sleep 6000ms

# ---------------------------------------------------------------
# SCENE 3 · Inspect the CI-ready reports
# ---------------------------------------------------------------
Ctrl+L

Type "# CI-ready reports were written during the check"
Enter
Sleep 500ms

Type "ls -la .leak-reports"
Enter
Sleep 2000ms

Type "cat .leak-reports/leak-report.md"
Enter
Sleep 5000ms

# ---------------------------------------------------------------
# SCENE 4 · Baseline grandfathering
# ---------------------------------------------------------------
Ctrl+L

Type "# Record a baseline: existing leaks become known issues"
Enter
Sleep 500ms

Type@4ms "cat << 'EOF' > vite.config.ts"
Enter
Type@4ms "import { defineConfig } from 'vite'"
Enter
Type@4ms "import react from '@vitejs/plugin-react'"
Enter
Type@4ms "import memoryLeakDetector from 'vite-plugin-memory-leak-detector'"
Enter
Type@4ms ""
Enter
Type@4ms "export default defineConfig({"
Enter
Type@4ms "  plugins: ["
Enter
Type@4ms "    react(),"
Enter
Type@4ms "    memoryLeakDetector({"
Enter
Type@4ms "      baseline: { path: '.leak-baseline.json', update: true }"
Enter
Type@4ms "    })"
Enter
Type@4ms "  ]"
Enter
Type@4ms "})"
Enter
Type@4ms "EOF"
Enter
Sleep 800ms

Type "npm run build"
Enter
Sleep 5000ms

Type "# Now enforce the baseline: only NEW leaks fail from here on"
Enter
Sleep 500ms

Type@4ms "cat << 'EOF' > vite.config.ts"
Enter
Type@4ms "import { defineConfig } from 'vite'"
Enter
Type@4ms "import react from '@vitejs/plugin-react'"
Enter
Type@4ms "import memoryLeakDetector from 'vite-plugin-memory-leak-detector'"
Enter
Type@4ms ""
Enter
Type@4ms "export default defineConfig({"
Enter
Type@4ms "  plugins: ["
Enter
Type@4ms "    react(),"
Enter
Type@4ms "    memoryLeakDetector({ baseline: '.leak-baseline.json' })"
Enter
Type@4ms "  ]"
Enter
Type@4ms "})"
Enter
Type@4ms "EOF"
Enter
Sleep 800ms

# ---------------------------------------------------------------
# SCENE 5 · Clean build verification
# ---------------------------------------------------------------
Ctrl+L

Type "# Same codebase, same leaks - but known now. Build it."
Enter
Sleep 600ms

Type "npm run build"
Enter
Sleep 5000ms

Type "# Finished - known leaks are grandfathered in, new leaks still fail the build."
Enter
Sleep 4000ms