@echo off
chcp 65001 > nul
echo ======================================================
echo  AUTOCONEXION MCP (Supabase, GitHub, Stripe, Context7, Playwright)
echo ======================================================
echo.
node scripts\setup-mcp.mjs
echo.
pause
