import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { User } from "../models/user.model.js";
import { uploadOnCloudinary } from "../utils/cloudinary.js";
import { ApiResponse } from "../utils/ApiResponse.js";

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
    }) || undefined;

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

    if(!userExists){
        const avatar = await uploadOnCloudinary(avatarLocalPath);
        const coverImage = await uploadOnCloudinary(coverImageLocalPath);
    }

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

export { registerUser };