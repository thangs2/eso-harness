# ESO harness — operator entry points.
# Local defaults: ENV=dev. runtime env files are created by bootstrap/runtime scripts
# and are gitignored; every recipe here is executed by the operator, never at parse time.
SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help

ENV ?= dev
LOG_TAIL ?= 200
BACKUP ?= latest
COMPOSE ?= docker compose

ENV_FILE := deploy/env/$(ENV).env
COMPOSE_SUFFIX := $(if $(filter dev,$(ENV)),dev,$(if $(filter e2e,$(ENV)),e2e,prod))
COMPOSE_FILE := deploy/compose/compose.$(COMPOSE_SUFFIX).yml
COMPOSE_CMD := $(COMPOSE) --env-file $(ENV_FILE) -f $(COMPOSE_FILE)
CHECK_ENV_FILE := $(if $(filter e2e,$(ENV)),deploy/env/dev.env.example,$(ENV_FILE).example)

.PHONY: help bootstrap build up down restart status logs e2e deploy rollback backup restore check

help: ## Show available targets (ENV=dev)
	@printf 'ESO harness deploy targets (ENV=%s)\n\n' '$(ENV)'
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z0-9_-]+:.*## / {printf "  %-12s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

bootstrap: ## Seed deploy/env/<env>.env if missing and start the stack (dev)
	@mkdir -p deploy/env deploy/.state deploy/backups deploy/logs
	@test -f $(ENV_FILE) || cp $(ENV_FILE).example $(ENV_FILE)
	$(COMPOSE_CMD) up -d --build

build: ## Build images for ENV
	$(COMPOSE_CMD) build

up: ## Start the stack in the background
	$(COMPOSE_CMD) up -d

down: ## Stop the stack (volumes are kept)
	$(COMPOSE_CMD) down

restart: ## Restart running services
	$(COMPOSE_CMD) restart

status: ## Show container status
	$(COMPOSE_CMD) ps

logs: ## Follow logs (LOG_TAIL=200)
	$(COMPOSE_CMD) logs --tail=$(LOG_TAIL) -f

e2e: ## Run the e2e suite via deploy/bin/stack/e2e.sh (no host ports)
	bash deploy/bin/stack/e2e.sh

deploy: ## Deploy ENV through the runtime script (state + health gates)
	bash deploy/bin/stack/deploy.sh $(ENV)

rollback: ## Roll ENV back to the previous release
	bash deploy/bin/stack/rollback.sh $(ENV)

backup: ## Back up the ENV database
	bash deploy/bin/db/backup.sh $(ENV)

restore: ## Restore the ENV database from BACKUP=<file>
	bash deploy/bin/db/restore.sh $(ENV) $(BACKUP)

check: ## Static checks only: shell syntax, compose config, build dry-run
	find deploy/bin -name "*.sh" -exec bash -n {} +
	$(COMPOSE) --env-file $(CHECK_ENV_FILE) -f $(COMPOSE_FILE) config -q
	@$(MAKE) --no-print-directory -n build
