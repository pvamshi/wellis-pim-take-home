# Top-level command surface for the repository.
# A bare `just` prints this list.

# List the available commands
default:
    @just --list

# Install every workspace, with one install at the root
install:
    npm install

# `npm run dev --workspaces` runs workspaces serially, so the api would start and
# the web app would never be reached. concurrently runs them side by side.

# Start the api and the web app together
dev:
    npx concurrently -k -n api,web -c blue,magenta "npm run dev -w apps/api" "npm run dev -w apps/web"

# Build every workspace that has a build script
build:
    npm run build --workspaces --if-present

# The workspace script runs with the working directory at apps/api, which is
# what makes '../../.env' and a relative `file:` DATABASE_URL resolve the same
# way `just dev` does. Pass a directory to import an export other than
# legacy_export/ at the repository root.

# Load legacy_export/ into the legacy tables
import *ARGS:
    npm run import -w apps/api -- {{ARGS}}

# The workspace script runs with the working directory at apps/api, which is what
# makes '../../.env' and a relative `file:` DATABASE_URL resolve the same way
# `just dev` does. `queue` prints every rule version waiting to be revised;
# `apply <file.json>` applies one revision. This is the revision workflow's hands
# on the database and is run by it, not by hand.

# Read the revision queue, or apply one revision
revise *ARGS:
    npm run revise -w apps/api -- {{ARGS}}

# --if-present is required: the web app has no test script by design, and its
# absence must not fail this recipe.

# Test every workspace that has a test script
test:
    npm run test --workspaces --if-present

# Lint the repository with the shared ESLint config
lint:
    npx eslint .

# Format the repository with the shared Prettier config
format:
    npx prettier --write .
