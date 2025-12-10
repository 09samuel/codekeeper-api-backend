# CodeKeeper API Backend

RESTful API server for CodeKeeper, providing authentication, file management, collaboration, AI integration, and cloud storage services. Built with Express.js and MongoDB for scalable backend operations.

🔗 **Main Project:** [CodeKeeper](https://codekeeper-nu.vercel.app/)

## Overview

This backend provides the REST API infrastructure that powers CodeKeeper's file management, user authentication, cloud storage, real-time collaboration, code execution, and AI features. It integrates with AWS S3 for file storage, MongoDB for data persistence, Piston API for code execution, and Pollinations AI for coding assistance.

## Features

- **User Authentication** - Secure JWT-based authentication with email verification
- **Document Management** - CRUD operations for code files and folders
- **Collaboration System** - Multi-user document sharing with permission management
- **Cloud Storage** - AWS S3 integration with signed URLs for secure file access
- **Code Execution** - Execute code in 50+ languages using Piston API
- **AI Integration** - Pollinations AI API for intelligent coding assistance
- **Email Services** - Brevo/Nodemailer for transactional emails and verification
- **Security** - Bcrypt password hashing and token-based authentication
- **CORS Support** - Cross-origin resource sharing for frontend integration

## Tech Stack

- **Node.js** (>= 16.0.0) - JavaScript runtime
- **Express.js** (v5.1.0) - Fast, minimalist web framework
- **MongoDB** (Mongoose v8.19.1) - NoSQL database with ODM
- **AWS S3** (aws-sdk v2.1692.0) - Cloud object storage with signed URLs
- **JWT** - Secure token-based authentication with refresh tokens
- **Bcrypt** - Password hashing and security
- **Axios** - HTTP client for external APIs


## Installation

```bash
# Clone the repository
git clone https://github.com/09samuel/codekeeper-api-backend.git
cd codekeeper-api-backend

# Install dependencies
npm install

# Configure environment variables
cp .env.example .env
# Edit .env with your configuration

# Start development server
npm run devStart

# Start production server
npm start
```

## Environment Variables

```env
PORT=3000
MONGODB_URI=your_mongodb_atlas_uri
JWT_SECRET=your_jwt_secret_here
JWT_REFRESH_SECRET=your_refresh_secret_here

# AWS S3 Configuration
AWS_ACCESS_KEY_ID=your_aws_access_key
AWS_SECRET_ACCESS_KEY=your_aws_secret_key
AWS_S3_BUCKET_NAME=your_bucket_name
AWS_REGION=us-east-1

# Email Service (Brevo/Nodemailer)
BREVO_API_KEY=your_brevo_api_key
EMAIL_FROM=noreply@codekeeper.com

# AI Integration
POLLINATIONS_AI_URL=https://text.pollinations.ai

# Piston API
PISTON_API_URL=https://emkc.org/api/v2/piston

NODE_ENV=production
```


## API Endpoints

### Authentication (`/api/auth`)
- `POST /register` - Register new user
- `POST /login` - User login (returns access & refresh tokens)
- `POST /refresh` - Refresh access token
- `POST /logout` - Logout user
- `GET /verify-email` - Verify user email address

### Documents (`/api/documents`)
- `GET /` - Get all user documents and folders
- `GET /:id` - Get document by ID
- `GET /:itemId/ownership` - Check document ownership
- `GET /:id/permission` - Get user's permission level for document
- `GET /signed-url` - Get AWS S3 signed URL for file access
- `POST /` - Create new document
- `POST /save` - Save document content to S3
- `POST /folders` - Create new folder
- `PUT /:id` - Rename document or folder
- `DELETE /:id` - Delete document or folder

### Collaborators (`/api/collaborators`)
- `GET /:id` - Get all collaborators for a document
- `POST /:id` - Add collaborator to document
- `PUT /:id/:collaboratorId` - Update collaborator permissions (view/edit)
- `DELETE /:id/:collaboratorId` - Remove collaborator from document

### Code Execution (`/api/code`)
- `POST /execute` - Execute code using Piston API
- `GET /runtimes` - Get available programming languages and versions

### AI Assistant (`/api/ai`)
- `POST /generate-text` - Generate AI responses using Pollinations AI


## Integration

This API works in conjunction with:

- **[Frontend](https://github.com/09samuel/codekeeper)** - Angular v20 client application
- **[WebSocket Backend](https://github.com/09samuel/codekeeper-backend)** - Real-time collaboration server


---

**Part of CodeKeeper Project**  
**Author:** Samuel  
**Main Repository:** [github.com/09samuel/codekeeper](https://github.com/09samuel/codekeeper)