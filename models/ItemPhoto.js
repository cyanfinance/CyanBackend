const mongoose = require('mongoose');

const itemPhotoSchema = new mongoose.Schema({
    loanId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Loan',
        required: true,
        index: true
    },
    goldItemIndex: {
        type: Number,
        required: true,
        min: -2
    },
    filename: {
        type: String,
        required: true
    },
    originalName: {
        type: String,
        required: true
    },
    mimeType: {
        type: String,
        required: true
    },
    size: {
        type: Number,
        required: true
    },
    // Store image data as Buffer for MongoDB GridFS alternative
    imageData: {
        type: Buffer,
        required: true
    },
    // Thumbnail for fast loading
    thumbnailData: {
        type: Buffer,
        required: true
    },
    // Image dimensions
    width: {
        type: Number,
        required: true
    },
    height: {
        type: Number,
        required: true
    },
    // Metadata
    uploadedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    uploadedAt: {
        type: Date,
        default: Date.now
    },
    // Image processing info
    compressionQuality: {
        type: Number,
        default: 85
    },
    isProcessed: {
        type: Boolean,
        default: true
    },
    // Tags for organization
    tags: [{
        type: String
    }],
    // Description of the photo
    description: {
        type: String,
        trim: true
    }
});

// Indexes for fast queries
itemPhotoSchema.index({ loanId: 1, goldItemIndex: 1 });
itemPhotoSchema.index({ uploadedAt: -1 });
itemPhotoSchema.index({ uploadedBy: 1 });

// Virtual for image URL (will be served via API)
itemPhotoSchema.virtual('imageUrl').get(function() {
    return `/loans/${this.loanId}/photos/${this._id}/image`;
});

itemPhotoSchema.virtual('thumbnailUrl').get(function() {
    return `/loans/${this.loanId}/photos/${this._id}/thumbnail`;
});

// Ensure virtual fields are serialized
itemPhotoSchema.set('toJSON', { virtuals: true });
itemPhotoSchema.set('toObject', { virtuals: true });

// Method to get photo metadata without image data
itemPhotoSchema.methods.getMetadata = function() {
    return {
        _id: this._id,
        loanId: this.loanId,
        goldItemIndex: this.goldItemIndex,
        filename: this.filename,
        originalName: this.originalName,
        mimeType: this.mimeType,
        size: this.size,
        width: this.width,
        height: this.height,
        uploadedBy: this.uploadedBy,
        uploadedAt: this.uploadedAt,
        compressionQuality: this.compressionQuality,
        isProcessed: this.isProcessed,
        tags: this.tags,
        description: this.description,
        imageUrl: this.imageUrl,
        thumbnailUrl: this.thumbnailUrl
    };
};

// Static method to get photos for a loan
itemPhotoSchema.statics.getPhotosForLoan = async function(loanId) {
    const photos = await this.find({ loanId })
        .select('-imageData -thumbnailData') // Exclude binary data for list view
        .populate('uploadedBy', 'name email')
        .sort({ goldItemIndex: 1, uploadedAt: 1 });
    
    // Ensure virtual URLs are included
    return photos.map(photo => photo.toObject());
};

// Static method to get photos for a specific gold item
itemPhotoSchema.statics.getPhotosForGoldItem = async function(loanId, goldItemIndex) {
    const photos = await this.find({ loanId, goldItemIndex })
        .select('-imageData -thumbnailData') // Exclude binary data for list view
        .populate('uploadedBy', 'name email')
        .sort({ uploadedAt: 1 });
    
    // Ensure virtual URLs are included
    return photos.map(photo => photo.toObject());
};

// Static method to delete all photos for a loan
itemPhotoSchema.statics.deleteByLoanId = function(loanId) {
    return this.deleteMany({ loanId });
};

module.exports = mongoose.model('ItemPhoto', itemPhotoSchema);
