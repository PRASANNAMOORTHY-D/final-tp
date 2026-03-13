import json
import time
from http.server import HTTPServer, BaseHTTPRequestHandler

class MockAIHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/health':
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            response = json.dumps({
                'status': 'healthy',
                'timestamp': time.time()
            })
            self.wfile.write(response.encode())
        
        elif self.path == '/':
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            response = json.dumps({
                'service': 'Mock AI Proctoring',
                'endpoints': ['/health', '/api/face-detection']
            })
            self.wfile.write(response.encode())
        
        else:
            self.send_response(404)
            self.end_headers()
    
    def do_POST(self):
        if self.path == '/api/face-detection':
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            
            response = json.dumps({
                'faceDetected': True,
                'faces': 1,
                'gazeDeviation': 18.5,
                'confidence': 0.94,
                'timestamp': time.time()
            })
            self.wfile.write(response.encode())
        
        elif self.path == '/api/object-detection':
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            
            response = json.dumps({
                'objects': [
                    {
                        'label': 'person',
                        'confidence': 0.95,
                        'isSuspicious': False
                    }
                ],
                'suspiciousCount': 0,
                'timestamp': time.time()
            })
            self.wfile.write(response.encode())
        
        else:
            self.send_response(404)
            self.end_headers()
    
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

if __name__ == '__main__':
    port = 8000
    server = HTTPServer(('localhost', port), MockAIHandler)
    print(f"🚀 Mock AI Server running on http://localhost:{port}")
    server.serve_forever()