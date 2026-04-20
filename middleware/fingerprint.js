import { createDeviceFingerprint } from '../utils/tokenService.js';

/**
 * Automatically generates a fingerprint for every request
 * and attaches it to the request object for controllers to use.
 */
export const fingerprinter = (req, res, next) => {
    const fingerprint = createDeviceFingerprint(req);
    req.fingerprint = fingerprint;
    next();
};