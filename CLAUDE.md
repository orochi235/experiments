# Experiments

A collection of standalone micro-projects. Each subdirectory is its own self-contained experiment.

## Structure

- Each subdirectory of `experiments/` is an independent project
- The root `index.html` is a **barrel file** — an auto-generated index linking to all experiments
- Experiments should be single-file or minimal-dependency where possible (CDN is fine)

## Barrel file (`index.html`)

When adding, removing, or renaming an experiment, regenerate or update the root `index.html` to reflect the current set of subdirectories. Each entry should link to the experiment's main HTML file and include a brief description.

To discover experiments: each subdirectory of the repo root (excluding `.git`) is an experiment. The main page is typically `index.html` or the only `.html` file in the directory.

Each card shows a "Last modified" date (from the last git commit touching that subdirectory). Cards are sorted newest-first.

## Conventions

- Single HTML files preferred (inline CSS/JS)
- CDN dependencies are fine; bundlers/build steps are not
- Dark theme (#1a1a2e background family) for visual consistency across experiments
- No frameworks unless the experiment is specifically about a framework
