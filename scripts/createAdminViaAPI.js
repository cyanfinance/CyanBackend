const axios = require('axios');

// This script will create an admin user by calling the registration API
// Make sure your server is running on the correct port

const createAdminViaAPI = async () => {
  try {
    const serverUrl = process.env.SERVER_URL || 'http://localhost:5001';
    
    console.log('🚀 Creating admin user via API...');
    
    const response = await axios.post(`${serverUrl}/api/auth/register`, {
      name: 'Admin User',
      email: 'rajajasti500@gmail.com',
      password: 'admin@123',
      role: 'admin'
    });

    console.log('✅ Admin user created successfully!');
    console.log('Response:', response.data);
    
  } catch (error) {
    if (error.response) {
      console.error('❌ API Error:', error.response.data);
      if (error.response.status === 400 && error.response.data.message === 'User already exists') {
        console.log('ℹ️  Admin user already exists in the database');
      }
    } else {
      console.error('❌ Network Error:', error.message);
      console.log('💡 Make sure your server is running on port 5001');
    }
  }
};

createAdminViaAPI();
