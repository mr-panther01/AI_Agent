# AI Agent CLI Tool - Scaler Assignment

This project contains a conversational AI CLI tool and a generated clone of the Scaler Academy website.

## CLI Agent
The agent is located in `agent.js`. It uses:
- **Node.js**
- **Inquirer.js** for the terminal UI.
- **Google Generative AI (Gemini)** for reasoning.
- **Filesystem actions** to write real files.

### Setup
1. Install dependencies:
   ```bash
   npm install
   ```
2. Create a `.env` file and add your Gemini API key:
   ```
   GEMINI_API_KEY=your_key_here
   ```
3. Run the agent:
   ```bash
   npm start
   ```

## Scaler Clone
The agent has generated a working clone of the Scaler website in the `output` folder.

### Features
- **Header**: Responsive nav with Scaler branding.
- **Hero Section**: Premium layout with animations and stats.
- **Footer**: Detailed site links with a dark theme.

### View the Output
Open `output/index.html` in any browser.
