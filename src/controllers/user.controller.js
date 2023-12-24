import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { User } from "../models/user.model.js";
import { uploadOnCloudinary } from "../utils/cloudinary.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import jwt from 'jsonwebtoken';

const options = {
    httpOnly: true,
    secure: true
}

const generateAccessAndRefreshTokens = async (userId) => {
    try {
        const user = await User.findById(userId);

        const accessToken = user.generateAccessToken();
        const refreshToken = user.generateRefreshToken();

        user.refreshToken = refreshToken;
        await user.save({ validateBeforeSave: false });

        return { accessToken, refreshToken };

    } catch (error) {
        throw new ApiError(500, "Something went wrong while generating Refresh and Access tokens");
    }
}

const registerUser = asyncHandler(async (req, res) => {
    /*
    Steps:
    1. Get details of the user from the frontend.
    2. Validate the details (Such as no field should be empty, proper format of email, etc.).
    3. Check if the user already exists.
    4. Check for images and avatar.
    5. Upload images to cloudinary.
    6. Create user object - create entry in DB.
    7. Remove refresh token and password from response.
    8. Check for user creation.
    9. return res
    */

    const { fullName, username, email, password } = req.body;

    if (
        [fullName, username, email, password].some((field)=>field.trim() === "")
    ) {
        throw new ApiError(400, "All fields are required.")
    }
    
    const userExists = await User.findOne({
        $or: [{ email }, { username }]
    });
    
    if( userExists ) {
        throw new ApiError(409, "Username or email already exists.")
    }
    
    const avatarLocalPath = req.files?.avatar[0]?.path;
    let coverImageLocalPath;
    if(req.files && Array.isArray(req.files.coverImage) && req.files.coverImage.length > 0){
        coverImageLocalPath = req.files.coverImage[0].path;
    }
    
    if(!avatarLocalPath){
        throw new ApiError(400, "Avatar file is required.")
    }
    
    const avatar = await uploadOnCloudinary(avatarLocalPath);
    const coverImage = await uploadOnCloudinary(coverImageLocalPath);
    
    if(!avatar){
        throw new ApiError(400, "Avatar file is required.")
    }

    const user = await User.create({
        fullName,
        avatar: avatar.url,
        coverImage: coverImage?.url || "",
        email,
        password,
        username: username.toLowerCase()
    })

    const createdUser = await User.findById(user._id).select(
        "-password -refreshToken"
    )

    if(!createdUser){
        throw new ApiError(500, "Something went wrong while registering the user.");
    }

    return res.status(201).json(
        new ApiResponse(200, createdUser, "User registered successfully.")
    )
    
})

const loginUser = asyncHandler(async (req, res) => {
    /* 
    Steps: 
    1. Get deatils for the user via frontend.
    2. Check if all the required fields are filled.
    3. Contact the database and check if the details (username/email and password pair) entered are correct.
    4. Generate access and refresh tokens.
    5. Send access and refresh tokens through secure cookies.
    */

    const { username, email, password } = req.body;

    if((!username && !email) || !password){
        throw new ApiError(400, "All the fields are required.");
    }

    const user = await User.findOne({
        $or: [{username}, {email}]
    })

    if(!user){
        throw new ApiError(404, "User does not exist.");
    }

    const isPasswordValid = await user.isPasswordCorrect(password);

    if(!isPasswordValid){
        throw new ApiError(404, "Invalid user credentials.");
    }

    const { accessToken, refreshToken } = await generateAccessAndRefreshTokens(user._id);

    const loggedInUser = await User.findById(user._id).select(
        "-password -refreshToken"
    )

    return res
    .status(200)
    .cookie("accessToken", accessToken, options)
    .cookie("refreshToken", refreshToken, options)
    .json(
        new ApiResponse(
            200,
            {
                user: loggedInUser, accessToken, refreshToken
            },
            "User logged in successfully."
        )
    )
    
})

const logoutUser = asyncHandler(async (req, res) => {
    await User.findByIdAndUpdate(
        req.user._id,
        {
            $set: {
                refreshToken: undefined
            }
        }
    )

    res
    .status(200)
    .clearCookie("accessToken", options)
    .clearCookie("refreshToken", options)
    .json(
        new ApiResponse(200, {}, "User logged out successfully.")
    )
})

const refreshAccessToken = asyncHandler(async (req, res) => {
    const incomingRefreshToken = req.cookies.refreshToken || req.body.refreshToken;

    if(!incomingRefreshToken){
        throw new ApiError(401, "Unauthorized request");
    }

    try {
        const decodedToken = jwt.verify(incomingRefreshToken, process.env.REFRESH_TOKEN_SECRET);
    
        const user = await User.findById(decodedToken?._id);
    
        if(!user){
            throw new ApiError(401, "Invalid refresh token");
        }
    
        if(incomingRefreshToken !== user?.refreshToken){
            throw new ApiError(401, "Refresh token is expired or used.");
        }
    
        const {accessToken, newRefreshToken} = await generateAccessAndRefreshTokens(user._id);
    
        return res
        .status(200)
        .cookie("accessToken", accessToken, options)
        .cookie("refreshToken", newRefreshToken, options)
        .json(
            new ApiResponse(200, {accessToken, refreshToken: newRefreshToken}, "Access Token refreshed")
        )
    } catch (error) {
        throw new ApiError(500, "")
    }
})

const changeCurrentPassword = asyncHandler(async (req, res) => {
    const { oldPassword, newPassword } = req.body;

    const user = await User.findById(req.user?._id);

    const isPasswordCorrect = await user.isPasswordCorrect(oldPassword);

    if(!isPasswordCorrect){
        throw new ApiError(400, "Invalid old password")
    }

    user.password = newPassword;
    
    await user.save({validateBeforeSave: false});

    return res.
    status(200)
    .json(
        new ApiResponse(
            200, 
            {},
            "Password changed successfully"
        )
    );
})

const getCurrentUser = asyncHandler(async (req, res) => {
    return res
    .status(200)
    .json(
        new ApiResponse(
            200,
            req.user,
            "Current user fetched successfully."
        )
    )
})

const updatefullName = asyncHandler(async (req, res) => {
    const { fullName } = req.body;
    const user = req.user;

    if(!fullName){
        throw new ApiError(400, "Full name is required.")
    }

    user.fullName = fullName;
    await user.save({validateBeforeSave: false});

    return res
    .status(200)
    .json(
        ApiResponse(
            200, 
            {},
            "Full name changed successfully"
        )
    )
})

const updateEmail = asyncHandler(async (req, res) => {
    const { email } = req.body;
    const user = req.user;

    if(!email){
        throw new ApiError(400, "Email is required.")
    }

    user.email = email;
    await user.save({validateBeforeSave: false});

    return res
    .status(200)
    .json(
        ApiResponse(
            200, 
            {},
            "Email changed successfully"
        )
    )
})

const updateUserAvatar = asyncHandler(async (req, res) => {
    const avatarLocalPath = req.file?.path;
    const user = req.user;

    if(!avatarLocalPath){
        throw new ApiError(
            400,
            "Avatar file is required"
        )
    }

    const avatar = await uploadOnCloudinary(avatarLocalPath);

    if(!avatar.url){
        throw new ApiError(500, "An error occurred while uploading the file.")
    }

    user.avatar = avatar.url;

    await user.save({validateBeforeSave: false});

    return res
    .status(
        200,
        {},
        "Avatar updated successfully."
    )
})

const updateUserCoverImage = asyncHandler(async (req, res) => {
    const coverImageLocalPath = req.file?.path;
    const user = req.user;

    if(!coverImageLocalPath){
        throw new ApiError(
            400,
            "Cover image file is required"
        )
    }

    const coverImage = await uploadOnCloudinary(coverImageLocalPath);

    if(!coverImage.url){
        throw new ApiError(500, "An error occurred while uploading the file.")
    }

    user.coverImage = coverImage.url;

    await user.save({validateBeforeSave: false});

    return res
    .status(
        200,
        {},
        "Cover image updated successfully."
    )
})

export {
    registerUser, 
    loginUser, 
    logoutUser, 
    refreshAccessToken, 
    changeCurrentPassword, 
    getCurrentUser, 
    updatefullName, 
    updateEmail, 
    updateUserAvatar,
    updateUserCoverImage
};