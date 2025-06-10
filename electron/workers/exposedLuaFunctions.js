import { getRandomNumber } from "../utils/getRandomNumber.js";

export const wait = async (minMs, maxMs) => {
    const delay = getRandomNumber(minMs, maxMs);
    return new Promise(resolve => setTimeout(resolve, delay));
};