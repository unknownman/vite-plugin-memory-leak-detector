# demo.tape
# This is a fully self-contained demo that creates a test project from scratch
# Prereqs: docker (for npx/npm isolation it starts in the repo dir's nested temp
# folder); node & npm must be installed and vite-plugin-memory-leak-detector must
# be published to npm before the plugin can be installed inside the demo.

Output demo.gif

Require npm
Require node

Set Shell "bash"
Set Theme "Catppuccin Mocha"
Set FontFamily "JetBrains Mono"
Set FontSize 16
Set Width 1200
Set Height 800
Set Padding 32
Set MarginBottom 4
Set TypingSpeed 35ms
Set Framerate 60

# ---------------------------------------------------------------
# STEP 1 — Scaffold a brand-new Vite + React + TypeScript project
# ---------------------------------------------------------------
Hide
Run "rm -rf memory-leak-demo"
Show

Type "# STEP 1 · Scaffold a brand-new Vite + React + TS project"
Enter
Sleep 700ms

Type "npm create vite@latest memory-leak-demo -- --template react-ts"
Enter
Hide
Sleep 7000ms
Type "n"
Enter
Sleep 19000ms
Show
Sleep 400ms

Type "cd memory-leak-demo"
Enter
Sleep 400ms

Type "# Installing all project dependencies (this may take a moment)"
Enter
Hide
Type "npm install"
Enter
Sleep 30000ms
Show
Sleep 400ms

# ----------------------------------------------------------------
# STEP 2 — Install the Memory Leak Detector plugin
# ----------------------------------------------------------------
Ctrl+L

Type "# STEP 2 · Install the Memory Leak Detector plugin"
Enter
Sleep 700ms

Type "npm install -D vite-plugin-memory-leak-detector"
Enter
Hide
Sleep 12000ms
Show
Sleep 400ms

# ----------------------------------------------------------------
# STEP 3 — Configure the plugin in vite.config.ts
# ----------------------------------------------------------------
Ctrl+L

Type "# STEP 3 · Configure the plugin"
Enter
Sleep 700ms

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
Type@4ms "      mode: 'error',              // fail the build when leaks are found"
Enter
Type@4ms "      thresholds: { maxWarnings: 0 },"
Enter
Type@4ms "      reports: ['stylish', 'markdown'],"
Enter
Type@4ms "      outputDir: '.leak-reports'"
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

Type "cat vite.config.ts"
Enter
Sleep 2500ms

# ----------------------------------------------------------------
# STEP 4 — Introduce a few all-too-real memory leaks
# ----------------------------------------------------------------
Ctrl+L

Type "# STEP 4 · Introduce some classic memory leaks"
Enter
Sleep 700ms

Type@4ms "cat << 'EOF' > src/App.tsx"
Enter
Type@4ms "import { useEffect } from 'react'"
Enter
Type@4ms ""
Enter
Type@4ms "export default function App() {"
Enter
Type@4ms "  // 1) useEffect without a cleanup -> leaks event listeners"
Enter
Type@4ms "  useEffect(() => {"
Enter
Type@4ms "    window.addEventListener('resize', () => console.log('resize'))"
Enter
Type@4ms "  }, [])"
Enter
Type@4ms ""
Enter
Type@4ms "  // 2) WebSocket connection that is never closed"
Enter
Type@4ms "  const ws = new WebSocket('ws://localhost:8080')"
Enter
Type@4ms ""
Enter
Type@4ms "  // 3) setInterval timer that is never cleared"
Enter
Type@4ms "  const timerId = setInterval(() => console.log('tick'), 1000)"
Enter
Type@4ms ""
Enter
Type@4ms "  // 4) an Observer - suppressed via an inline directive"
Enter
Type@4ms "  // memory-leak-ignore-next-line generic/no-unconnected-observers"
Enter
Type@4ms "  const obs = new IntersectionObserver(() => {})"
Enter
Type@4ms ""
Enter
Type@4ms "  console.log('live handles:', timerId, ws.readyState, obs)"
Enter
Type@4ms "  return <h1>Memory Leak Detector</h1>"
Enter
Type@4ms "}"
Enter
Type@4ms "EOF"
Enter
Sleep 800ms

# ---------------------------------------------------------------
# STEP 5 — Run the build and catch the leaks (mode: error)
# ---------------------------------------------------------------
Ctrl+L

Type "# STEP 5 · Run the build and watch the detector do its thing"
Enter
Sleep 700ms

Type "npm run build"
Enter
Sleep 9500ms
Sleep 1500ms

# ---------------------------------------------------------------
# STEP 6 — CI-ready reports (report-only mode)
# ---------------------------------------------------------------
Ctrl+L

Type "# STEP 6 · Switch to report-only mode and generate HTML + SARIF + Markdown"
Enter
Sleep 700ms

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
Type@4ms "      mode: 'report-only',        // never blocks the build"
Enter
Type@4ms "      reports: ['html', 'sarif', 'markdown'],"
Enter
Type@4ms "      outputDir: '.leak-reports'"
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
Sleep 7000ms
Type "ls -la .leak-reports"
Enter
Sleep 2000ms
Type "head -40 .leak-reports/leak-report.md"
Enter
Sleep 5000ms

# ---------------------------------------------------------------
# STEP 7 — Record a baseline of legacy issues
# ---------------------------------------------------------------
Ctrl+L

Type "# STEP 7 · Legacy codebase? Record a baseline so known issues are grandfathered in"
Enter
Sleep 700ms

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
Sleep 8000ms

# ------------------------------------------------------------------
# STEP 8 — Enforce the baseline & ship a green build
# ------------------------------------------------------------------
Ctrl+L

Type "# STEP 8 · Enforce the baseline - only NEW leaks will fail future builds"
Enter
Sleep 700ms

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

Type "npm run build"
Enter
Sleep 9000ms

Type "# Clean build! Known leaks are ignored, new ones will still fail the build."
Enter
Sleep 6000ms