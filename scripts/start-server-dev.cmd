@echo off
REM Started in a separate window by start-prediction-insider.bat
cd /d "%~dp0.."
title PredictionInsider Server
echo Loading .env from %CD%
npm run dev
