/** @type {import('tailwindcss').Config} */
export default {
    content: ["./index.html", "./src/**/*.{vue,js,ts,jsx,tsx}"],
    theme: {
        extend: {
        colors: {
            brand: {
            50: "#fff0f7",
            100: "#ffe4f0",
            200: "#ffc6de",
            300: "#ff9fcc",
            400: "#ff6bb1",
            500: "#E4007C", // primary
            600: "#cc006f",
            700: "#a8005c",
            800: "#86004b",
            900: "#6d003e",
            },
        },
        },
    },
    plugins: [],
};
