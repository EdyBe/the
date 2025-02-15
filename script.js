// Initialize page
document.addEventListener('DOMContentLoaded', () => {
    try {
        // Handle forgot password form if it exists
        const forgotPasswordForm = document.getElementById('forgotPasswordForm');
        if (forgotPasswordForm) {
            forgotPasswordForm.addEventListener('submit', async function(event) {
                event.preventDefault();
                const email = this.email.value;
                const messageArea = document.getElementById('messageArea');
                
                try {
                    const response = await fetch('/api/forgot-password', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ email })
                    });

                    const data = await response.text();
                    messageArea.innerText = data;
                    messageArea.style.color = response.ok ? 'green' : 'red';
                } catch (error) {
                    messageArea.innerText = 'An error occurred. Please try again.';
                    messageArea.style.color = 'red';
                }
            });
        }

        // Handle sign-in form if it exists
        const signInForm = document.getElementById('signInForm');
        if (signInForm) {
            signInForm.addEventListener('submit', async function(event) {
                event.preventDefault();
                const email = this[0].value;
                const password = this[1].value;

                try {
                    const response = await fetch('/sign-in', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ email, password })
                    });

                    const data = await response.json();
                    if (response.ok) {
                        // Store user email in session storage
                        sessionStorage.setItem('userEmail', data.user.email); // Store the user email in session storage
                        console.log('User email stored in session storage:', email); // Log the stored email
                        
                        // Redirect to the appropriate dashboard
                        window.location.href = data.redirectPage;
                    } else {
                        const errorMessage = document.getElementById('errorMessage');
                        errorMessage.innerText = data.message;
                        errorMessage.style.display = 'block'; // Show the error message
                    }
                } catch (error) {
                    const errorMessage = document.getElementById('errorMessage');
                    errorMessage.innerText = error.message;
                    errorMessage.style.display = 'block'; // Show the error message
                }
            });
        }

        // Function to check account limit
        async function checkAccountLimit(classCode) {
            const response = await fetch(`/api/checkAccountLimit?classCode=${classCode}`);
            const data = await response.json();
            return data.count < ACCOUNT_LIMITS[classCode];
        }

        // Handle registration form if it exists
        const registerForm = document.getElementById('registerForm');
        if (registerForm) {
            registerForm.addEventListener('submit', async function(event) {
                event.preventDefault();
                const userData = {
                    firstName: this[0].value,
                    email: this[1].value,
                    password: this[2].value,
                    classCode: this[3].value,
                    licenseKey: this[4].value,
                    accountType: this[5].value
                };

                // Validate license key based on account type
                const validLicenseKeys = {
                    student: ["STUDENT_KEY_1", "STUDENT_KEY_2"], // Replace with actual student license keys
                    teacher: ["TEACHER_KEY_1", "TEACHER_KEY_2"]  // Replace with actual teacher license keys
                };

                if (!validLicenseKeys[userData.accountType].includes(userData.licenseKey)) {
                    document.getElementById('registerErrorMessage').innerText = 'Invalid license key for the selected account type.';
                    return; // Stop form submission
                }

                try {
                    const response = await fetch('/register', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(userData)
                    });

                    const data = await response.json();
                    if (response.ok) {
                        // Store user email in session storage
                        sessionStorage.setItem('userEmail', userData.email); // Store the user email in session storage
                        console.log('User email stored in session storage:', userData.email); // Log the stored email
                        
                        // Redirect to the appropriate dashboard using the response data
                        window.location.href = data.redirectPage;
                    } else {
                        document.getElementById('registerErrorMessage').innerText = data.message;
                    }
                } catch (error) {
                    document.getElementById('registerErrorMessage').innerText = error.message;
                }
            });
        }

        // Handle upload form if it exists
        const uploadForm = document.getElementById('uploadForm');
        if (uploadForm) {
            uploadForm.addEventListener('submit', async function(event) {
                event.preventDefault();
                const email = sessionStorage.getItem('userEmail');
                if (!email) {
                    throw new Error('User not authenticated');
                }
                
                const title = this[0].value;
                const subject = this[1].value;
                const fileInput = this.querySelector('input[type="file"]');
                
                // Show the loading spinner
                document.getElementById('loadingSpinner').style.display = 'block';
                
                // Get Class Code from user session
                const userInfo = await fetch('/user-info?email=' + encodeURIComponent(email))
                    .then(res => res.json())
                    .catch(() => {
                        throw new Error('Failed to fetch user info');
                    });
                if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
                    throw new Error('Please select a video file to upload');
                }
                const videoFile = fileInput.files[0];

                // Get Class Code from user info
                const classCode = userInfo.classCode; // Retrieve classCode from userInfo
                
                // Create a FormData object to send the video file
                const formData = new FormData();
                formData.append('email', email);
                formData.append('title', title);
                formData.append('subject', subject);
                formData.append('video', videoFile);
                formData.append('classCode', classCode);

                try {
                    const response = await fetch('/upload', { 
                        method: 'POST',
                        headers: {
                            'Accept': 'application/json'
                        },
                        body: formData
                    });

                    // Hide the loading spinner
                    document.getElementById('loadingSpinner').style.display = 'none';
                    
                    if (response.ok) {
                        // Display the success message
                        document.getElementById('uploadSuccessMessage').innerText = 'Your work was successfully uploaded!';
                    } else {
                        throw new Error('Upload failed');
                    }
                } catch (error) {
                    // Hide the loading spinner
                    document.getElementById('loadingSpinner').style.display = 'none';
                }
            });
        }
    } catch (error) {
        console.error('Error initializing page:', error);
    }
        
});

// Function to delete a video
function deleteVideo(videoId) {
    if (confirm("Are you sure you want to delete this video? This action cannot be undone.")) {
        fetch(`/delete-video?id=${videoId}`, { method: 'DELETE' })
            .then(response => {
                if (response.ok) {
                    location.reload(); // Refresh the page to reflect changes
                } else {
                    console.error('Failed to delete video');
                }
            });
    }
}

// Handle sign-out button if it exists
const signOutButton = document.getElementById('signOutButton'); // Assuming the button has this ID
if (signOutButton) {
    signOutButton.addEventListener('click', function() {
        // Clear user session
        sessionStorage.removeItem('userEmail'); // Remove user email from session storage
        console.log('User signed out'); // Log sign-out action
        
        // Redirect to sign-in page
        window.location.href = 'sign-in.html';
    });
}
