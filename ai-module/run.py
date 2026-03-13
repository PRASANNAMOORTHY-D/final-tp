import subprocess
import sys
import os

def check_python():
    print("🔍 Checking Python installation...")
    try:
        import flask
        print("✅ Flask is installed")
    except ImportError:
        print("❌ Flask not found. Installing...")
        subprocess.check_call([sys.executable, "-m", "pip", "install", "flask", "flask-cors", "numpy"])
    
    try:
        import cv2
        print("✅ OpenCV is installed")
    except ImportError:
        print("❌ OpenCV not found. Installing...")
        subprocess.check_call([sys.executable, "-m", "pip", "install", "opencv-python"])

if __name__ == "__main__":
    check_python()
    print("🚀 Starting AI Module...")
    os.system(f"{sys.executable} app.py")