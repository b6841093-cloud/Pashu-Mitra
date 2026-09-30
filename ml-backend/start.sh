#!/bin/bash
set -e

echo "🚀 Starting Pashu Shield ML Backend..."

# Check if models exist, if not train them
if [ ! -f "models/rf_model.pkl" ] || [ ! -f "models/scaler.pkl" ] || [ ! -f "models/iso_model.pkl" ]; then
    echo "📦 Models not found. Training models..."
    python train_model.py
    echo "✅ Models trained successfully"
else
    echo "✅ Models found, skipping training"
fi

# Verify model files
ls -la models/

# Start the FastAPI server
echo "🌐 Starting Uvicorn server on port ${PORT:-10000}..."
exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-10000} --workers 1 --timeout-keep-alive 120