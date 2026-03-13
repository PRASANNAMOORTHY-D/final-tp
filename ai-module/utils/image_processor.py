import cv2
import numpy as np
from typing import Tuple, Optional, List
import base64
from PIL import Image
import io
import logging

logger = logging.getLogger(__name__)

class ImageProcessor:
    """Utility class for image processing operations"""
    
    @staticmethod
    def base64_to_image(base64_string: str) -> Optional[np.ndarray]:
        """
        Convert base64 string to OpenCV image
        
        Args:
            base64_string: Base64 encoded image string
            
        Returns:
            OpenCV image or None if conversion fails
        """
        try:
            # Remove data URL prefix if present
            if ',' in base64_string:
                base64_string = base64_string.split(',')[1]
            
            # Decode base64
            image_bytes = base64.b64decode(base64_string)
            image_array = np.frombuffer(image_bytes, dtype=np.uint8)
            
            # Decode image
            image = cv2.imdecode(image_array, cv2.IMREAD_COLOR)
            
            if image is None:
                logger.error("Failed to decode image from base64")
                return None
            
            return image
            
        except Exception as e:
            logger.error(f"Base64 to image conversion error: {str(e)}")
            return None
    
    @staticmethod
    def image_to_base64(image: np.ndarray, format: str = 'jpeg', quality: int = 90) -> str:
        """
        Convert OpenCV image to base64 string
        
        Args:
            image: OpenCV image
            format: Output format (jpeg, png)
            quality: JPEG quality (1-100)
            
        Returns:
            Base64 encoded image string
        """
        try:
            # Convert OpenCV BGR to RGB
            if len(image.shape) == 3 and image.shape[2] == 3:
                image_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
            else:
                image_rgb = image
            
            # Convert to PIL Image
            pil_image = Image.fromarray(image_rgb)
            
            # Convert to bytes
            buffer = io.BytesIO()
            
            if format.lower() == 'png':
                pil_image.save(buffer, format='PNG')
                mime_type = 'image/png'
            else:  # Default to JPEG
                pil_image.save(buffer, format='JPEG', quality=quality, optimize=True)
                mime_type = 'image/jpeg'
            
            # Encode to base64
            image_bytes = buffer.getvalue()
            base64_string = base64.b64encode(image_bytes).decode('utf-8')
            
            return f"data:{mime_type};base64,{base64_string}"
            
        except Exception as e:
            logger.error(f"Image to base64 conversion error: {str(e)}")
            return ""
    
    @staticmethod
    def resize_image(image: np.ndarray, max_size: Tuple[int, int] = (1280, 720)) -> np.ndarray:
        """
        Resize image while maintaining aspect ratio
        
        Args:
            image: Input image
            max_size: Maximum (width, height)
            
        Returns:
            Resized image
        """
        try:
            h, w = image.shape[:2]
            max_w, max_h = max_size
            
            # Calculate scaling factor
            scale = min(max_w / w, max_h / h)
            
            if scale < 1:  # Only resize if image is larger than max size
                new_w = int(w * scale)
                new_h = int(h * scale)
                resized = cv2.resize(image, (new_w, new_h), interpolation=cv2.INTER_AREA)
                return resized
            
            return image
            
        except Exception as e:
            logger.error(f"Image resize error: {str(e)}")
            return image
    
    @staticmethod
    def preprocess_for_detection(image: np.ndarray) -> np.ndarray:
        """
        Preprocess image for object/face detection
        
        Args:
            image: Input image
            
        Returns:
            Preprocessed image
        """
        try:
            # Convert to RGB if BGR
            if len(image.shape) == 3 and image.shape[2] == 3:
                image_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
            else:
                image_rgb = image
            
            # Normalize pixel values to [0, 1]
            normalized = image_rgb.astype(np.float32) / 255.0
            
            # Optional: Apply histogram equalization for better contrast
            if len(normalized.shape) == 3:  # Color image
                # Convert to YUV and equalize Y channel
                yuv = cv2.cvtColor((normalized * 255).astype(np.uint8), cv2.COLOR_RGB2YUV)
                yuv[:,:,0] = cv2.equalizeHist(yuv[:,:,0])
                equalized = cv2.cvtColor(yuv, cv2.COLOR_YUV2RGB)
                normalized = equalized.astype(np.float32) / 255.0
            
            return normalized
            
        except Exception as e:
            logger.error(f"Image preprocessing error: {str(e)}")
            return image
    
    @staticmethod
    def extract_face_region(image: np.ndarray, bbox: dict) -> np.ndarray:
        """
        Extract face region from image
        
        Args:
            image: Input image
            bbox: Bounding box dictionary with x, y, width, height
            
        Returns:
            Cropped face region
        """
        try:
            x, y, w, h = bbox['x'], bbox['y'], bbox['width'], bbox['height']
            
            # Add padding
            padding = 20
            x = max(0, x - padding)
            y = max(0, y - padding)
            w = min(w + 2 * padding, image.shape[1] - x)
            h = min(h + 2 * padding, image.shape[0] - y)
            
            face_region = image[y:y+h, x:x+w]
            return face_region
            
        except Exception as e:
            logger.error(f"Face region extraction error: {str(e)}")
            return np.array([])
    
    @staticmethod
    def calculate_brightness(image: np.ndarray) -> float:
        """
        Calculate image brightness
        
        Args:
            image: Input image
            
        Returns:
            Brightness value (0-100)
        """
        try:
            if len(image.shape) == 3:
                # Convert to grayscale
                gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
            else:
                gray = image
            
            # Calculate mean pixel value
            brightness = np.mean(gray)
            
            # Normalize to 0-100 range
            normalized = (brightness / 255.0) * 100
            
            return float(normalized)
            
        except Exception as e:
            logger.error(f"Brightness calculation error: {str(e)}")
            return 50.0
    
    @staticmethod
    def calculate_sharpness(image: np.ndarray) -> float:
        """
        Calculate image sharpness using Laplacian variance
        
        Args:
            image: Input image
            
        Returns:
            Sharpness value (higher = sharper)
        """
        try:
            if len(image.shape) == 3:
                gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
            else:
                gray = image
            
            # Apply Laplacian filter
            laplacian = cv2.Laplacian(gray, cv2.CV_64F)
            
            # Calculate variance
            sharpness = np.var(laplacian)
            
            return float(sharpness)
            
        except Exception as e:
            logger.error(f"Sharpness calculation error: {str(e)}")
            return 0.0
    
    @staticmethod
    def detect_blur(image: np.ndarray, threshold: float = 100.0) -> bool:
        """
        Detect if image is blurry
        
        Args:
            image: Input image
            threshold: Sharpness threshold
            
        Returns:
            True if image is blurry
        """
        sharpness = ImageProcessor.calculate_sharpness(image)
        return sharpness < threshold
    
    @staticmethod
    def enhance_image(image: np.ndarray) -> np.ndarray:
        """
        Enhance image quality for better detection
        
        Args:
            image: Input image
            
        Returns:
            Enhanced image
        """
        try:
            # Convert to LAB color space
            lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
            
            # Split channels
            l, a, b = cv2.split(lab)
            
            # Apply CLAHE to L channel
            clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
            l_enhanced = clahe.apply(l)
            
            # Merge channels
            lab_enhanced = cv2.merge([l_enhanced, a, b])
            
            # Convert back to BGR
            enhanced = cv2.cvtColor(lab_enhanced, cv2.COLOR_LAB2BGR)
            
            return enhanced
            
        except Exception as e:
            logger.error(f"Image enhancement error: {str(e)}")
            return image
    
    @staticmethod
    def create_montage(images: List[np.ndarray], grid_size: Tuple[int, int] = (2, 2)) -> np.ndarray:
        """
        Create montage of multiple images
        
        Args:
            images: List of images
            grid_size: (rows, columns)
            
        Returns:
            Montage image
        """
        try:
            rows, cols = grid_size
            max_images = rows * cols
            
            # Take only first N images
            images = images[:max_images]
            
            if not images:
                return np.zeros((100, 100, 3), dtype=np.uint8)
            
            # Resize all images to same size
            h, w = images[0].shape[:2]
            resized_images = []
            
            for img in images:
                resized = cv2.resize(img, (w, h))
                resized_images.append(resized)
            
            # Create montage grid
            montage_rows = []
            
            for i in range(0, len(resized_images), cols):
                row_images = resized_images[i:i+cols]
                
                # Pad row if needed
                while len(row_images) < cols:
                    row_images.append(np.zeros((h, w, 3), dtype=np.uint8))
                
                # Concatenate horizontally
                row_montage = np.hstack(row_images)
                montage_rows.append(row_montage)
            
            # Concatenate vertically
            montage = np.vstack(montage_rows)
            
            return montage
            
        except Exception as e:
            logger.error(f"Montage creation error: {str(e)}")
            return np.zeros((100, 100, 3), dtype=np.uint8)