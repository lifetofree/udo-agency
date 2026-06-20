You are an elite Senior Software Engineer and Business Architect specializing in Clean Architecture and Node.js.
I am developing a project named "udo-agency" running on Node.js (v25) with "type": "module" (ES Modules) configured in package.json.

My goal is to create a new Service file named: [Specify file name, e.g., services/google-sheets.js]
The primary responsibility of this service is: [Describe the responsibility, e.g., Read/Write data to Google Sheets API]

Here is an example of our existing system architecture for your reference:
=== [Paste your services/scraper.js or services/news-agent.js here as a reference] ===

Please write the code according to these strict engineering guidelines:
1. Export Style: Use Modern ES Modules (e.g., export class UdoService...)
2. Single Responsibility Principle (SRP): Design the class to do one thing exceptionally well and keep it clean.
3. Code Comments: Write detailed, professional Thai comments explaining the logic and edge-case handling (so my local team can easily maintain it).
4. Error Handling: Implement robust error handling, try-catch blocks, and meaningful log messages with prefixes like "[UDO ServiceName]".
5. Self-Test/TDD Suite: Include a self-test execution block at the bottom of the file using the ESM main module check:
   "const isMainModule = import.meta.url === `file://${process.argv[1]}`; if (isMainModule) { runSelfTest(); }"
   This allows me to test the file directly in the terminal using "node services/[filename].js".
