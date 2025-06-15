import { getRandomNumber } from "../utils/getRandomNumber.js";

export const wait = async (min_ms, max_ms) => {
    const delay = max_ms === undefined ? min_ms : getRandomNumber(min_ms, max_ms);
    return new Promise(resolve => setTimeout(resolve, delay));
};