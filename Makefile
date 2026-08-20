all:
	npm run build || true
	cp -r dist/. .
