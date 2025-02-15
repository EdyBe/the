const { MongoClient, GridFSBucket } = require('mongodb');

// Database Configuration
// Note: For production, move these to environment variables
// Connection URL - Currently using local MongoDB instance
const url = 'mongodb://127.0.0.1:27017/';
const client = new MongoClient(url);

// Database Name - Defaults to 'test'
// To change database, modify this value or use environment variable
const dbName = 'test'; // Changed to 'test'

// License Key Management System
// Defines maximum number of accounts per license key
// Structure: { "licenseKey": maxAccounts }
const licenseKeyLimits = {
    "BurnsideHighSchool": 4,  // Example school license
    "MP003": 8,               // Example license
    "3399": 20,               // Example license
    "STUDENT_KEY_1": 10,       // Default student license
    "TEACHER_KEY_2": 10,      // Default teacher license
    // Add more license keys and their limits as needed
};

// Valid License Keys by Account Type
// Defines which license keys are valid for each account type
// Structure: { accountType: ["licenseKey1", "licenseKey2"] }
const validLicenseKeys = {
    student: ["STUDENT_KEY_1", "STUDENT_KEY_2"], // Valid student license keys
    teacher: ["TEACHER_KEY_1", "TEACHER_KEY_2"]  // Valid teacher license keys
};

/**
 * Establishes connection to MongoDB database
 * @returns {Promise<Db>} MongoDB database instance
 * @throws {Error} If connection fails
 */
async function connectToDatabase() {
    try {
        // Connect to MongoDB server
        await client.connect();
        console.log('Connected successfully to MongoDB server');

        // Access the specified database
        const db = client.db(dbName);
        console.log(`Database "${dbName}" is ready for use`);

        return db;
    } catch (error) {
        console.error('Error connecting to MongoDB:', error);
        throw error; // Rethrow to allow calling code to handle
    }
}

/**
 * Creates a new user in the database
 * @param {Object} userData - User information including email, licenseKey, and accountType
 * @returns {Promise<Object>} Created user data
 * @throws {Error} If user creation fails
 */
async function createUser(userData) {
    const db = client.db(dbName);
    const usersCollection = db.collection('users');

    // Validate email uniqueness
    console.log("Checking for existing user with email:", userData.email);
    const existingUser = await usersCollection.findOne({ email: userData.email });
    console.log("Existing user found:", existingUser ? existingUser.email : "No user found");
    if (existingUser) {
        throw new Error('Email already in use');
    }

    // Validate license key for account type
    if (!validLicenseKeys[userData.accountType].includes(userData.licenseKey)) {
        throw new Error('Invalid license key for the selected account type.');
    }

    // Check license key usage limits
    const licenseKeyCount = await usersCollection.countDocuments({ licenseKey: userData.licenseKey });
    const licenseKeyLimit = licenseKeyLimits[userData.licenseKey] || 0;

    console.log(`License key: ${userData.licenseKey}, Registered count: ${licenseKeyCount}, Limit: ${licenseKeyLimit}`);

    if (licenseKeyCount >= licenseKeyLimit) {
        throw new Error('License key limit reached. No more accounts can be registered with this key.');
    }
    
    // Insert new user
    console.log("User data being inserted:", userData);
    try {
        const result = await usersCollection.insertOne(userData);
        console.log("Insert result:", result);
        if (result && result.insertedId) {
            console.log("User successfully registered:", userData);
            return userData;
        } else {
            throw new Error('Failed to retrieve inserted user data');
        }
    } catch (error) {
        console.log("User data being inserted:", userData);
        console.error("Error during user registration:", error);
        throw new Error('Failed to register user');
    }
}

/**
 * Retrieves user information and associated videos
 * @param {string} email - User's email address
 * @returns {Promise<Object>} Object containing user data and associated videos
 * @throws {Error} If user is not found
 */
async function readUser(email) {
    const db = client.db(dbName);
    const usersCollection = db.collection('users');

    // Find user by email
    const user = await usersCollection.findOne({ email: email });
    if (!user) {
        throw new Error('User not found');
    }

    // Fetch all videos associated with the user
    const videosCollection = db.collection('videos');
    const videos = await videosCollection.find({ userId: user._id }).toArray();

    return { user, videos };
}

/**
 * Updates user's class codes by adding or removing a code
 * @param {string} email - User's email address
 * @param {Object} options - Contains classCode to add/remove
 * @param {string} action - 'add' or 'delete' operation
 * @returns {Promise<Object>} Success message
 * @throws {Error} If user not found or operation fails
 */
async function updateUser(email, { classCode }, action) {
    const db = client.db(dbName);
    const usersCollection = db.collection('users');

    // Verify user exists
    const user = await usersCollection.findOne({ email });
    if (!user) {
        throw new Error('User not found');
    }

    if (action === 'add') {
        // Add new class code to user's array
        const result = await usersCollection.updateOne(
            { email: email },
            { $push: { classCodesArray: classCode } }
        );

        if (result.modifiedCount === 0) {
            throw new Error('No changes made while adding class code');
        }
    } else if (action === 'delete') {
        // Verify class code exists before removal
        if (!user.classCodesArray.includes(classCode)) {
            throw new Error('Class code does not exist');
        }

        // Remove class code from user's array
        const result = await usersCollection.updateOne(
            { email: email },
            { $pull: { classCodesArray: classCode } }
        );

        if (result.modifiedCount === 0) {
            throw new Error('No changes made while deleting class code');
        }
    } else {
        throw new Error('Invalid action. Use "add" or "delete".');
    }

    return { message: `Class code ${action === 'add' ? 'added' : 'deleted'} successfully!` };
}

/**
 * Deletes a user and optionally their associated videos
 * @param {string} email - User's email address
 * @returns {Promise<Object>} Delete operation result
 * @throws {Error} If user is not found
 */
async function deleteUser(email) {
    const db = client.db(dbName);
    const usersCollection = db.collection('users');

    // Delete user by email
    const result = await usersCollection.deleteOne({ email: email });
    if (result.deletedCount === 0) {
        throw new Error('User not found');
    }

    // Clean up associated videos
    const videosCollection = db.collection('videos');
    await videosCollection.deleteMany({ userId: result._id });

    return result;
}

/**
 * Uploads a video to GridFS storage with associated metadata
 * @param {Object} videoData - Video information including buffer, metadata, and user details
 * @returns {Promise<Object>} Upload result containing file ID and metadata
 * @throws {Error} If upload fails
 */
async function uploadVideo(videoData) {
    try {
        console.log('Connecting to database for video upload...');
        const db = client.db(dbName);
        if (!db) {
            throw new Error('Database connection failed');
        }

        // Initialize GridFS bucket for video storage
        const bucket = new GridFSBucket(db, {
            bucketName: 'videos'
        });

        // Convert video buffer to readable stream
        const readableVideoStream = require('stream').Readable.from(videoData.buffer);
        
        console.log('Video MIME type:', videoData.mimetype);
        
        // Configure upload stream with metadata
        const uploadStream = bucket.openUploadStream(videoData._id, {
            metadata: {
                title: videoData.title,
                subject: videoData.subject,
                userId: videoData.userId,
                userEmail: videoData.userEmail,
                classCode: videoData.classCode,
                contentType: videoData.mimetype,
                viewed: false,
                schoolName: videoData.schoolName
            }
        });

        // Handle video upload process
        return new Promise((resolve, reject) => {
            readableVideoStream.pipe(uploadStream)
                .on('error', (error) => {
                    console.error('Error during upload stream:', error);
                    console.error('Error uploading video to GridFS:', error);
                    reject(new Error('Failed to upload video: ' + error.message));
                })
                .on('finish', () => {
                    console.log('Upload stream finished, video should be stored in GridFS. File ID:', uploadStream.id);
                    console.log('Video metadata:', uploadStream.options.metadata);
                    console.log('Video uploaded successfully to GridFS, checking for chunks...');
                    resolve({
                        fileId: uploadStream.id,
                        filename: uploadStream.filename,
                        metadata: uploadStream.options.metadata
                    });
                });
        });
    } catch (error) {
        console.error('Error uploading video:', error);
        throw new Error('Failed to upload video: ' + error.message);
    }
}

module.exports = { connectToDatabase, createUser, readUser, updateUser, deleteUser, uploadVideo };
