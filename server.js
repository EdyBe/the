// Server Configuration and Initialization
require('dotenv').config(); // Load environment variables from .env file
const express = require('express'); // Express framework for handling HTTP requests
const { 
    sendPasswordResetEmail, 
    generateResetToken, 
    storeResetToken, 
    validateResetToken, 
    deleteResetToken 
} = require('./emailService'); // Email service functions for password reset
const multer = require('multer'); // Middleware for handling file uploads

// Database related imports
const { connectToDatabase, uploadVideo, createUser, updateUser } = require('./db');
const path = require('path'); // Path module for file path operations
const cors = require('cors'); // CORS middleware for cross-origin requests

// Initialize Express application
const app = express();
const port = 3000; // Server port

// Security and database modules
const bcrypt = require('bcrypt'); // For password hashing
const { MongoClient, ObjectId } = require('mongodb'); // MongoDB client
const mongodb = require('mongodb'); // MongoDB module for GridFS operations

// Application Configuration
const validSchoolNames = ["Burnside", "STAC", "School C"]; // List of valid school names
const validLicenseKeys = ["BurnsideHighSchool", "MP003", "3399", "STUDENT_KEY_1", "TEACHER_KEY_2"]; // Valid license keys

// Database Connection Setup
const uri = 'mongodb://127.0.0.1:27017/test'; // MongoDB connection URI
const client = new MongoClient(uri); // Create MongoDB client
let db; // Global database reference

// Middleware Configuration
app.use(express.json()); // Parse JSON request bodies
app.use(cors()); // Enable CORS for all routes

// Global error handler middleware
app.use((err, req, res, next) => {
    console.error('Global error handler:', err);
    res.status(500).json({ 
        message: 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

// Verify database connection
async function verifyDatabaseConnection() {
    try {
        const db = await connectToDatabase();
        console.log('Database connection verified');
        return db;
    } catch (error) {
        console.error('Database connection failed:', error);
        process.exit(1);
    }
}

// Verify database connection on startup
verifyDatabaseConnection();
// File Upload Configuration
const upload = multer({
    storage: multer.memoryStorage(), // Store files in memory
    limits: {
        fileSize: 5 * 1024 * 1024 * 1024, // 5GB file size limit
        fieldSize: 5 * 1024 * 1024 * 1024 // 5GB field size limit
    },
    fileFilter: (req, file, cb) => {
        // Validate file type - only allow video files
        if (file.mimetype.startsWith('video/')) {
            cb(null, true);
        } else {
            cb(new Error('Only video files are allowed'), false);
        }
    }
});

/**
 * Retrieves user information including first name, class codes, and school name
 * @param {string} email - User's email address (query parameter)
 * @returns {Object} JSON response with user information
 */
app.get('/user-info', async (req, res) => {
    try {
        const email = req.query.email;
        if (!email) {
            return res.status(400).json({ message: 'Email is required' });
        }

        const db = await connectToDatabase();
        const user = await db.collection('users').findOne({ email });
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Capitalize first name for display
        const capitalizedFirstName = user.firstName.charAt(0).toUpperCase() + user.firstName.slice(1);
        
        res.json({
            firstName: capitalizedFirstName,
            classCodes: user.classCodesArray,
            schoolName: user.schoolName
        });
    } catch (error) {
        console.error('Error fetching user info:', error);
        res.status(500).json({ message: 'Failed to fetch user info' });
    }
});

/**
 * Handles video uploads to GridFS storage
 * @param {Object} req.file - Uploaded video file
 * @param {Object} req.body - Video metadata
 * @returns {Object} JSON response with upload status
 */
app.post('/upload', upload.single('video'), async (req, res) => {
    console.log('Upload request received');
    console.log('Request body:', req.body);
    console.log('Uploaded file:', req.file);

    if (!req.file) {
        console.log('No file uploaded');
        return res.status(400).json({ message: 'No video file uploaded' });
    }

    try {
        console.log('Connecting to database...');
        const db = await connectToDatabase();
        const usersCollection = db.collection('users');
        
        console.log('Looking up user:', req.body.email);
        const user = await usersCollection.findOne({ email: req.body.email });
        if (!user) {
            console.log('User not found');
            return res.status(404).json({ message: 'User not found' });
        }

        // Prepare video data for storage
        const videoData = {
            title: req.body.title,
            subject: req.body.subject,
            userId: user._id.toString(),
            userEmail: user.email,
            classCode: req.body.classCode,
            accountType: user.accountType,
            schoolName: user.schoolName,
            buffer: req.file.buffer,
            filename: `${Date.now()}_${req.file.originalname}`,
            mimetype: req.file.mimetype,
            studentName: user.firstName
        };

        // Check for existing video with same metadata
        const existingVideo = await db.collection('videos.files').findOne({
            'metadata.userEmail': user.email,
            'metadata.title': req.body.title,
            'metadata.classCode': req.body.classCode
        });

        if (existingVideo) {
            return res.status(400).json({ message: 'A video with the same title and class code already exists' });
        }

        console.log('Video data:', videoData);

        // Create GridFS bucket
        const bucket = new mongodb.GridFSBucket(db, { bucketName: 'videos' });

        console.log('Uploading video to database...');
        const uploadStream = bucket.openUploadStream(videoData.filename, {
            metadata: {
                title: videoData.title,
                subject: videoData.subject,
                userId: videoData.userId,
                userEmail: videoData.userEmail,
                classCode: videoData.classCode,
                accountType: videoData.accountType,
                schoolName: videoData.schoolName,
                studentName: videoData.studentName,
                uploadDate: new Date()
            }
        });

        // Write buffer to GridFS stream
        uploadStream.end(videoData.buffer);

        // Wait for upload to complete
        await new Promise((resolve, reject) => {
            uploadStream
                .on('finish', resolve)
                .on('error', reject);
        });
        

        // Redirect back to upload page after successful upload
        res.redirect('/upload-.html');
    } catch (error) {
        console.error('Video upload error:', error);
        res.status(500).json({ 
            message: 'Failed to upload video',
            error: error.message 
        });
    }
});

// Serve static files from the current directory
app.use(express.static(__dirname));

/**
 * Handles user registration with validation and account creation
 * @param {Object} req.body - Registration data including license key, school name, etc.
 * @returns {Object} JSON response with registration status
 */
app.post('/register', async (req, res) => {
    console.log("Registration request received:", req.body);
    console.log("Valid license keys:", validLicenseKeys);
    const { licenseKey, schoolName, firstName, email, password, classCodes, accountType } = req.body;
    console.log("License key received:", licenseKey);

    if (validLicenseKeys.includes(licenseKey)) {
        // Validate school name
        if (!validSchoolNames.includes(schoolName)) {
            return res.status(400).json({ message: "Invalid school name." });
        }
        
        // Process class codes
        const classCodesArray = classCodes.split(',').map(code => code.trim());
        console.log("Password received:", password);
        
        // Hash password for secure storage
        const hashedPassword = await bcrypt.hash(password, 10);

        const db = await connectToDatabase();
        const usersCollection = db.collection('users');

        // Check for existing user
        console.log("Checking for existing user with email:", email);
        const existingUser = await usersCollection.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ message: "Email already in use." });
        }

        // Create new user object
        const newUser = {
            firstName,
            email,
            password: hashedPassword,
            classCodesArray,
            licenseKey,
            accountType,
            schoolName
        };

        // Create user in database
        try {
            await createUser(newUser);
            res.status(200).json({ message: "Registration successful!", email });
        } catch (error) {
            console.error("Error during user registration:", error.message);
            res.status(400).json({ message: error.message });
        }
    } else {
        res.status(400).json({ message: "Invalid license key" });
    }
});

/**
 * Retrieves class codes associated with a user
 * @param {string} email - User's email address (query parameter)
 * @returns {Array} JSON array of class codes
 */
app.get('/class-codes', async (req, res) => {
    try {
        const email = req.query.email;
        if (!email) {
            return res.status(400).json({ message: 'Email is required' });
        }

        const db = await connectToDatabase();
        const user = await db.collection('users').findOne({ email });
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Return user's class codes
        res.status(200).json(user.classCodesArray);
    } catch (error) {
        console.error('Error fetching class codes:', error);
        res.status(500).json({ message: 'Failed to fetch class codes' });
    }
});

/**
 * Handles user authentication and session initiation
 * @param {string} email - User's email address
 * @param {string} password - User's password
 * @returns {Object} JSON response with authentication status and redirect information
 */
app.post('/sign-in', async (req, res) => {
    const { email, password } = req.body;
    console.log("Sign-in request received:", req.body);

    try {
        const db = await connectToDatabase();
        const usersCollection = db.collection('users');

        // Find user by email
        const user = await usersCollection.findOne({ email: email });
        if (!user) {
            return res.status(400).json({ message: "Invalid email or password" });
        }

        // Validate password
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(400).json({ message: "Invalid email or password" });
        }

        // Determine redirect page based on account type
        const redirectPage = user.accountType === 'teacher' ? 'teacher-.html' : 'student-.html';
        res.status(200).json({ 
            message: "Sign-in successful!", 
            redirectPage, 
            user: { 
                email: user.email, 
                firstName: user.firstName, 
                accountType: user.accountType 
            } 
        });
    } catch (error) {
        console.error("Error during sign-in:", error);
        res.status(500).json({ message: "Internal server error." });
    }
});

app.delete('/delete-account', async (req, res) => {
    const email = req.query.email; // Get the email from the query parameter
    console.log('Delete account request received for email:', email); // Log the email

    if (!email) {
        return res.status(400).json({ message: 'Email is required' });
    }

    try {
        const db = await connectToDatabase();
        
        // Find the user to get their ID
        const user = await db.collection('users').findOne({ email });
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Delete associated videos based on userEmail in metadata
        await db.collection('videos.files').deleteMany({ 'metadata.userEmail': email });

        // Delete associated video chunks
        await db.collection('videos.chunks').deleteMany({ files_id: { $in: user.videoIds || [] } }); // Ensure videoIds is treated as an array

        // Delete the user
        await db.collection('users').deleteOne({ email });

        console.log('Account deleted successfully for email:', email);
        res.status(200).json({ message: 'Account deleted successfully' });
    } catch (error) {
        console.error('Error deleting account:', error);
        res.status(500).json({ message: 'Failed to delete account' });
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'sign-in.html')); // Serve sign-in.html
});

app.get('/videos.files/:id', async (req, res) => {
    console.log('Attempting to retrieve video from GridFS with ID:', req.params.id);
    try {
        const db = await connectToDatabase();
        const bucket = new mongodb.GridFSBucket(db, {bucketName: 'videos'});
        
        const videoId = new mongodb.ObjectId(req.params.id);
        const chunks = await db.collection('videos.chunks').find({ files_id: videoId }).toArray();
        console.log('Chunks found for video ID:', chunks.length); // Log the number of chunks found

        if (chunks.length === 0) {
            console.error('No chunks found for video ID:', req.params.id);
            return res.status(404).json({ message: 'Video chunks not found' });
        }
        const videoFile = await db.collection('videos.files').findOne({ _id: videoId });
        if (!videoFile) {
            console.error('Video not found in database:', req.params.id);
            return res.status(404).json({ message: 'Video not found' });
        }
        const downloadStream = bucket.openDownloadStream(videoId);
        console.log('Opening download stream for video ID:', videoId.toString()); // Log the ID being used for streaming
        downloadStream.on('error', (error) => {
            console.error('Error downloading video:', error);
            res.status(404).json({ message: 'Video not found' });
        });

        res.set('Content-Type', videoFile.metadata.contentType || 'video/mp4'); // Set the correct Content-Type
        downloadStream.pipe(res);
    } catch (error) {
        console.error('Error testing video:', error);
        res.status(500).json({ message: 'Failed to test video' });
    }
});

app.get('/videos.chunks/:id', async (req, res) => {
    try {
        const db = await connectToDatabase();
        const bucket = new mongodb.GridFSBucket(db);
        
        const videoId = new mongodb.ObjectId(req.params.id);
        const chunks = await db.collection('videos.chunks').find({ files_id: videoId }).toArray();
        res.status(200).json(chunks);
    } catch (error) {
        console.error('Error listing video chunks:', error);
        res.status(500).json({ message: 'Failed to list video chunks' });
    }
});
    
app.get('/videos', async (req, res) => {
    try {
        const db = await connectToDatabase();
        const bucket = new mongodb.GridFSBucket(db, {bucketName: 'videos'});
        
        const email = req.query.email;
        if (!email) {
            return res.status(400).json({ message: 'Email is required' });
        }
        
        // Find user to get their ID and class code
        const usersCollection = db.collection('users');
        console.log('Received email for video fetch:', email); // Log the received email
        const user = await usersCollection.findOne({ email });
        console.log('User found:', user); // Log the user found
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        
        // Find videos based on account type
        let videos = [];
        
        if (user.accountType === 'teacher') {
            // For teachers, get all videos from their class code and school name
            console.log('Fetching videos for teacher:', user.email);
            const classCodes = user.classCodesArray; // Get the array of class codes
            const query = { 
                'metadata.classCode': { $in: classCodes },
                'metadata.schoolName': user.schoolName // Match the school name
            }; 
            console.log('Teacher query:', query);
            
            // Query GridFS files collection
            videos = await db.collection('videos.files')
                .find(query)
                .toArray();
        } else {
            // For students, get only their own videos
            console.log('Fetching videos for student:', user.email);
            const query = { 
                'metadata.userEmail': user.email
            };
            console.log('Student query:', query);
            
            // Query GridFS files collection
            videos = await db.collection('videos.files')
                .find(query)
                .toArray();
        }
        
        console.log('Found videos:', videos.length);
        console.log('Video details:', videos);
            
        res.status(200).json(videos);
    } catch (error) {
        console.error('Error fetching videos:', error);
        res.status(500).json({ message: 'Failed to fetch videos' });
    }
});

app.delete('/delete-video', async (req, res) => {
    const videoId = req.query.id; // Get the video ID from the query parameter
    console.log('Delete request received for video ID:', videoId); // Log the video ID

    if (!videoId) {
        return res.status(400).json({ message: 'Video ID is required' });
    }

    try {
        const db = await connectToDatabase();
        const videoResult = await db.collection('videos.files').deleteOne({ _id: new ObjectId(videoId) });
        
        // Delete associated video chunks
        const chunksResult = await db.collection('videos.chunks').deleteMany({ files_id: new ObjectId(videoId) });

        if (videoResult.deletedCount === 0) {
            console.error('No video found with ID:', videoId);
            return res.status(404).json({ message: 'Video not found' });
        }

        console.log('Video deleted successfully:', videoId);
        res.status(200).json({ message: 'Video deleted successfully' });
    } catch (error) {
        console.error('Error deleting video:', error);
        res.status(500).json({ message: 'Failed to delete video' });
    }
});

app.post('/videos/view', async (req, res) => {
    const videoId = req.body.id; // Get the video ID from the request body
    console.log('Mark as viewed request received for video ID:', videoId); // Log the video ID

    if (!videoId) {
        return res.status(400).json({ message: 'Video ID is required' });
    }

    try {
        const db = await connectToDatabase();
        const result = await db.collection('videos.files').updateOne(
            { _id: new ObjectId(videoId) },
            { $set: { 'metadata.viewed': true } } // Update the viewed status
        );

        if (result.modifiedCount === 0) {
            console.error('No video found with ID:', videoId);
            return res.status(404).json({ message: 'Video not found or already viewed' });
        }

        console.log('Video marked as viewed successfully:', videoId);
        res.status(200).json({ message: 'Video marked as viewed successfully' });
    } catch (error) {
        console.error('Error marking video as viewed:', error);
        res.status(500).json({ message: 'Failed to mark video as viewed' });
    }
});

// Password Reset Request Endpoint
app.post('/api/forgot-password', async (req, res) => {
    const { email } = req.body;

    try {
        const db = await connectToDatabase();
        const usersCollection = db.collection('users');
        
        // Check if the email exists in the database
        const user = await usersCollection.findOne({ email });
        
        // For security, don't reveal if email exists or not
        if (!user) {
            // Still return success to prevent email enumeration
            return res.status(200).send('If your email exists in our system, you will receive a password reset link.');
        }

        // Generate and store reset token
        const token = generateResetToken();
        storeResetToken(email, token);

        // Log the reset link (for development/testing)
        console.log('Password reset link:', `http://localhost:3000/reset-password.html?token=${token}`);

        // In production, this would send an actual email
        await sendPasswordResetEmail(email, token);

        res.status(200).send('If your email exists in our system, you will receive a password reset link.');
    } catch (error) {
        console.error('Error processing password reset request:', error);
        // Generic error message for security
        return res.status(500).send('An error occurred. Please try again later.');
    }
});

// Password Reset Endpoint
app.post('/api/reset-password', async (req, res) => {
    const { token, newPassword } = req.body;

    try {
        // Validate the reset token
        const email = validateResetToken(token);
        if (!email) {
            return res.status(400).send('This password reset link has expired or is invalid. Please request a new one.');
        }

        const db = await connectToDatabase();
        const usersCollection = db.collection('users');

        // Hash the new password and update it in the database
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        const result = await usersCollection.updateOne(
            { email }, 
            { $set: { password: hashedPassword } }
        );

        if (result.modifiedCount === 0) {
            return res.status(400).send('Unable to update password. Please try again.');
        }

        // Delete the used token
        deleteResetToken(token);

        res.status(200).send('Your password has been reset successfully. You can now log in with your new password.');
    } catch (error) {
        console.error('Error resetting password:', error);
        return res.status(500).send('An error occurred while resetting your password. Please try again.');
    }
});

app.put('/update-user', async (req, res) => {
    const email = req.body.email; // Get the email from the request body
    const { classCode } = req.body; // Get the class code from the request body
    const action = req.body.action; // Get the action (add or delete)

    if (!email || !classCode || !action) {
        return res.status(400).json({ message: 'Email, class code, and action are required' });
    }

    try {
        const db = await connectToDatabase();
        const user = await db.collection('users').findOne({ email });
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Update the user's class codes
        await updateUser(email, { classCode }, action);
        res.status(200).json({ message: `Class code ${action === 'add' ? 'added' : 'deleted'} successfully!` });
    } catch (error) {
        console.error('Error updating user class codes:', error);
        res.status(500).json({ message: 'Code invalid' });
    }
});
app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});
