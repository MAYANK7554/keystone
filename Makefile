.PHONY: up down build logs test clean

up:
	docker compose up --build -d
	@echo ""
	@echo "Stack is running:"
	@echo "  Frontend: http://localhost:3000"
	@echo "  Backend:  http://localhost:8000"
	@echo "  Health:   http://localhost:8000/health"

down:
	docker compose down

build:
	docker compose build

logs:
	docker compose logs -f

test:
	cd backend && pytest -v

clean:
	docker compose down -v --remove-orphans
