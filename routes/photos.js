const express = require('express');
const router = express.Router();
const multer = require('multer');
const sharp = require('sharp');
const { body, validationResult } = require('express-validator');
const ItemPhoto = require('../models/ItemPhoto');
const Loan = require('../models/Loan');
const auth = require('../middleware/auth');
const adminAuth = require('../middleware/adminAuth');

// Configure multer for memory storage (we'll store in MongoDB)
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit
        files: 5 // Maximum 5 files per request
    },
    fileFilter: (req, file, cb) => {
        // Check if file is an image
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed'), false);
        }
    }
});

// Helper function to process and compress images
const processImage = async (buffer, quality = 85) => {
    try {
        // Get image metadata
        const metadata = await sharp(buffer).metadata();
        
        // Process main image (resize if too large, compress)
        let processedImage = sharp(buffer);
        
        // Resize if width > 1920px
        if (metadata.width > 1920) {
            processedImage = processedImage.resize(1920, null, {
                withoutEnlargement: true,
                fit: 'inside'
            });
        }
        
        // Convert to JPEG and compress
        const processedBuffer = await processedImage
            .jpeg({ quality, progressive: true })
            .toBuffer();
        
        // Create thumbnail (300px max width)
        const thumbnailBuffer = await sharp(buffer)
            .resize(300, null, {
                withoutEnlargement: true,
                fit: 'inside'
            })
            .jpeg({ quality: 80, progressive: true })
            .toBuffer();
        
        // Get final metadata
        const finalMetadata = await sharp(processedBuffer).metadata();
        
        return {
            processedBuffer,
            thumbnailBuffer,
            width: finalMetadata.width,
            height: finalMetadata.height,
            size: processedBuffer.length
        };
    } catch (error) {
        throw new Error(`Image processing failed: ${error.message}`);
    }
};

// @route   POST /api/loans/:loanId/photos
// @desc    Upload photos for a specific loan's gold items
// @access  Private (Admin/Employee)
router.post('/:loanId/photos', [
    auth,
    adminAuth,
    upload.array('photos', 5), // Allow up to 5 photos
    [
        body('goldItemIndex').isInt({ min: -2 }).withMessage('Valid gold item index is required (-2 for bank receipt, -1 for all items together)'),
        body('description').optional().isString().withMessage('Description must be a string'),
        body('tags').optional().isArray().withMessage('Tags must be an array')
    ]
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { loanId } = req.params;
        const { goldItemIndex, description, tags } = req.body;
        const files = req.files;

        if (!files || files.length === 0) {
            return res.status(400).json({ message: 'No photos uploaded' });
        }

        // Verify loan exists and user has access
        const loan = await Loan.findById(loanId);
        if (!loan) {
            return res.status(404).json({ message: 'Loan not found' });
        }

        // Verify gold item index is valid (allow -2 for bank receipt, -1 for "all items together" photo)
        if (goldItemIndex !== -2 && goldItemIndex !== -1 && goldItemIndex >= loan.goldItems.length) {
            return res.status(400).json({ message: 'Invalid gold item index' });
        }

        const uploadedPhotos = [];

        // Process each uploaded file
        for (const file of files) {
            try {
                // Process the image
                const processed = await processImage(file.buffer);
                
                // Create photo document
                const photo = new ItemPhoto({
                    loanId,
                    goldItemIndex: parseInt(goldItemIndex),
                    filename: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}.jpg`,
                    originalName: file.originalname,
                    mimeType: 'image/jpeg',
                    size: processed.size,
                    imageData: processed.processedBuffer,
                    thumbnailData: processed.thumbnailBuffer,
                    width: processed.width,
                    height: processed.height,
                    uploadedBy: req.user.id,
                    compressionQuality: 85,
                    description: description || '',
                    tags: tags || []
                });

                await photo.save();

                // Add photo reference to appropriate location
                if (goldItemIndex === -2) {
                    // Add to bank receipt photos
                    if (!loan.bankReceiptPhotos) {
                        loan.bankReceiptPhotos = [];
                    }
                    loan.bankReceiptPhotos.push(photo._id);
                } else if (goldItemIndex === -1) {
                    // Add to "all items together" photos
                    loan.allItemsTogetherPhotos.push(photo._id);
                } else {
                    // Add to specific gold item
                    loan.goldItems[goldItemIndex].photos.push(photo._id);
                }
                await loan.save();

                uploadedPhotos.push(photo.getMetadata());
            } catch (error) {
                console.error(`Error processing file ${file.originalname}:`, error);
                // Continue with other files even if one fails
            }
        }

        res.status(201).json({
            success: true,
            message: `${uploadedPhotos.length} photos uploaded successfully`,
            data: uploadedPhotos
        });

    } catch (error) {
        console.error('Error uploading photos:', error);
        res.status(500).json({ message: 'Server error during photo upload' });
    }
});

// @route   GET /api/loans/:loanId/photos
// @desc    Get all photos for a loan
// @access  Private (Admin/Employee)
router.get('/:loanId/photos', auth, async (req, res) => {
    try {
        const { loanId } = req.params;

        // Verify loan exists
        const loan = await Loan.findById(loanId);
        if (!loan) {
            return res.status(404).json({ message: 'Loan not found' });
        }

        const photos = await ItemPhoto.getPhotosForLoan(loanId);

        res.json({
            success: true,
            data: photos
        });
    } catch (error) {
        console.error('Error fetching photos:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   GET /api/loans/:loanId/photos/public
// @desc    Get all photos for a loan (public endpoint for printing)
// @access  Public (for print display)
router.get('/:loanId/photos/public', async (req, res) => {
    try {
        const { loanId } = req.params;

        // Verify loan exists
        const loan = await Loan.findById(loanId);
        if (!loan) {
            return res.status(404).json({ message: 'Loan not found' });
        }

        const photos = await ItemPhoto.getPhotosForLoan(loanId);

        res.json({
            success: true,
            data: photos
        });
    } catch (error) {
        console.error('Error fetching photos:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   GET /api/loans/:loanId/photos/:photoId/image
// @desc    Get full-size image (public endpoint for display)
// @access  Public (for image display)
router.get('/:loanId/photos/:photoId/image', async (req, res) => {
    try {
        const { loanId, photoId } = req.params;
        console.log('Serving full image for:', { loanId, photoId });

        const photo = await ItemPhoto.findOne({ _id: photoId, loanId });
        if (!photo) {
            console.log('Photo not found:', { loanId, photoId });
            return res.status(404).json({ message: 'Photo not found' });
        }

        console.log('Photo found, image data length:', photo.imageData?.length);

        if (!photo.imageData) {
            console.log('No image data found for photo:', photoId);
            return res.status(404).json({ message: 'Image not found' });
        }

        res.set({
            'Content-Type': photo.mimeType,
            'Content-Length': photo.imageData.length,
            'Cache-Control': 'public, max-age=31536000', // Cache for 1 year
            'ETag': `"${photo._id}"`
        });

        res.send(photo.imageData);
    } catch (error) {
        console.error('Error serving image:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   GET /api/loans/:loanId/photos/:photoId/thumbnail
// @desc    Get thumbnail image (public endpoint for display)
// @access  Public (for image display)
router.get('/:loanId/photos/:photoId/thumbnail', async (req, res) => {
    try {
        const { loanId, photoId } = req.params;
        console.log('Serving thumbnail for:', { loanId, photoId });

        const photo = await ItemPhoto.findOne({ _id: photoId, loanId });
        if (!photo) {
            console.log('Photo not found:', { loanId, photoId });
            return res.status(404).json({ message: 'Photo not found' });
        }

        console.log('Photo found, thumbnail data length:', photo.thumbnailData?.length);

        if (!photo.thumbnailData) {
            console.log('No thumbnail data found for photo:', photoId);
            
            // Try to regenerate thumbnail from image data
            if (photo.imageData) {
                console.log('Attempting to regenerate thumbnail from image data...');
                try {
                    const sharp = require('sharp');
                    const thumbnailBuffer = await sharp(photo.imageData)
                        .resize(300, null, {
                            withoutEnlargement: true,
                            fit: 'inside'
                        })
                        .jpeg({ quality: 80, progressive: true })
                        .toBuffer();
                    
                    // Update the photo with new thumbnail
                    photo.thumbnailData = thumbnailBuffer;
                    await photo.save();
                    
                    console.log('Thumbnail regenerated and saved!');
                    
                    res.set({
                        'Content-Type': 'image/jpeg',
                        'Content-Length': thumbnailBuffer.length,
                        'Cache-Control': 'public, max-age=31536000',
                        'ETag': `"${photo._id}-thumb-regenerated"`
                    });
                    
                    return res.send(thumbnailBuffer);
                } catch (regenerateError) {
                    console.error('Failed to regenerate thumbnail:', regenerateError);
                    return res.status(404).json({ message: 'Thumbnail not found and could not be regenerated' });
                }
            } else {
                return res.status(404).json({ message: 'Thumbnail not found' });
            }
        }

        res.set({
            'Content-Type': 'image/jpeg',
            'Content-Length': photo.thumbnailData.length,
            'Cache-Control': 'public, max-age=31536000', // Cache for 1 year
            'ETag': `"${photo._id}-thumb"`
        });

        res.send(photo.thumbnailData);
    } catch (error) {
        console.error('Error serving thumbnail:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   GET /api/loans/:loanId/gold-items/:itemIndex/photos
// @desc    Get photos for a specific gold item
// @access  Private (Admin/Employee)
router.get('/:loanId/gold-items/:itemIndex/photos', auth, async (req, res) => {
    try {
        const { loanId, itemIndex } = req.params;
        const goldItemIndex = parseInt(itemIndex);

        // Verify loan exists
        const loan = await Loan.findById(loanId);
        if (!loan) {
            return res.status(404).json({ message: 'Loan not found' });
        }

        // Verify gold item index is valid
        if (goldItemIndex >= loan.goldItems.length) {
            return res.status(400).json({ message: 'Invalid gold item index' });
        }

        const photos = await ItemPhoto.getPhotosForGoldItem(loanId, goldItemIndex);

        res.json({
            success: true,
            data: photos
        });
    } catch (error) {
        console.error('Error fetching gold item photos:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   DELETE /api/loans/:loanId/photos/:photoId
// @desc    Delete a photo
// @access  Private (Admin/Employee)
router.delete('/:loanId/photos/:photoId', [auth, adminAuth], async (req, res) => {
    try {
        const { loanId, photoId } = req.params;

        const photo = await ItemPhoto.findOne({ _id: photoId, loanId });
        if (!photo) {
            return res.status(404).json({ message: 'Photo not found' });
        }

        // Remove photo reference from appropriate location
        const loan = await Loan.findById(loanId);
        if (loan) {
            // Remove from gold items
            loan.goldItems.forEach(item => {
                item.photos = item.photos.filter(pid => !pid.equals(photoId));
            });
            
            // Remove from all items together photos
            if (loan.allItemsTogetherPhotos) {
                loan.allItemsTogetherPhotos = loan.allItemsTogetherPhotos.filter(pid => !pid.equals(photoId));
            }
            
            // Remove from bank receipt photos
            if (loan.bankReceiptPhotos) {
                loan.bankReceiptPhotos = loan.bankReceiptPhotos.filter(pid => !pid.equals(photoId));
            }
            
            await loan.save();
        }

        // Delete photo document
        await ItemPhoto.findByIdAndDelete(photoId);

        res.json({
            success: true,
            message: 'Photo deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting photo:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   PUT /api/loans/:loanId/photos/:photoId
// @desc    Update photo metadata
// @access  Private (Admin/Employee)
router.put('/:loanId/photos/:photoId', [
    auth,
    adminAuth,
    [
        body('description').optional().isString().withMessage('Description must be a string'),
        body('tags').optional().isArray().withMessage('Tags must be an array')
    ]
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { loanId, photoId } = req.params;
        const { description, tags } = req.body;

        const photo = await ItemPhoto.findOne({ _id: photoId, loanId });
        if (!photo) {
            return res.status(404).json({ message: 'Photo not found' });
        }

        // Update metadata
        if (description !== undefined) photo.description = description;
        if (tags !== undefined) photo.tags = tags;

        await photo.save();

        res.json({
            success: true,
            message: 'Photo updated successfully',
            data: photo.getMetadata()
        });
    } catch (error) {
        console.error('Error updating photo:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;
