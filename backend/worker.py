"""Cloudflare Workers entrypoint for the existing FastAPI application."""

from workers import asgi

from app.main import app

Default = asgi.entrypoint(app)
