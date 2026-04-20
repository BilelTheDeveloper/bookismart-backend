// This is used for routes that strictly require a valid Refresh Cookie
export const requireRefreshCookie = (req, res, next) => {
    const token = req.cookies.refreshToken;
    if (!token) {
        return res.status(401).json({ message: "Session expired, please login again" });
    }
    next();
};