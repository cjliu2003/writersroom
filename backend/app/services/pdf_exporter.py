"""
PDF Exporter Service

Generates PDF files from screenplay content using Playwright.
Renders HTML with industry-standard screenplay CSS and exports to PDF.
"""

import logging
from typing import List, Dict, Any, Optional
from pathlib import Path

logger = logging.getLogger(__name__)

# Template directory path
TEMPLATE_DIR = Path(__file__).parent.parent / "templates"


class PDFExporter:
    """
    PDF exporter that converts screenplay content blocks to PDF format.
    Uses Playwright to render HTML with screenplay CSS and export to PDF.
    """

    # Mapping from backend block types to CSS classes
    TYPE_TO_CLASS = {
        'scene_heading': 'scene-heading',
        'action': 'action',
        'character': 'character',
        'dialogue': 'dialogue',
        'parenthetical': 'parenthetical',
        'transition': 'transition',
        'shot': 'action',  # Treat shot as action
        'general': 'action',  # Treat general as action
    }

    @classmethod
    async def generate_pdf(
        cls,
        title: str,
        content_blocks: List[Dict[str, Any]],
    ) -> bytes:
        """
        Generate a PDF from screenplay content blocks.

        Args:
            title: Script title
            content_blocks: List of content block dicts with 'type' and 'text'

        Returns:
            PDF file as bytes
        """
        logger.info(f"Generating PDF for script: {title}")
        logger.info(f"Processing {len(content_blocks)} content blocks")

        # Build HTML content
        html_content = cls._build_html(title, content_blocks)

        # Generate PDF using Playwright
        pdf_bytes = await cls._render_pdf(html_content)

        logger.info(f"Successfully generated PDF ({len(pdf_bytes)} bytes)")
        return pdf_bytes

    @classmethod
    def _build_html(cls, title: str, content_blocks: List[Dict[str, Any]]) -> str:
        """
        Build HTML document from content blocks.

        Args:
            title: Script title
            content_blocks: List of content block dicts

        Returns:
            Complete HTML document string
        """
        # Build paragraph elements
        paragraphs = []
        for block in content_blocks:
            block_type = block.get('type', 'action')
            text = block.get('text', '')

            if not text or not text.strip():
                continue

            css_class = cls.TYPE_TO_CLASS.get(block_type, 'action')
            # Escape HTML entities
            escaped_text = (
                text.replace('&', '&amp;')
                .replace('<', '&lt;')
                .replace('>', '&gt;')
                .replace('"', '&quot;')
            )
            paragraphs.append(f'<p class="{css_class}">{escaped_text}</p>')

        body_content = '\n'.join(paragraphs)

        # Read the print CSS
        css_content = cls._get_print_css()

        # Build complete HTML document
        html = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{title}</title>
    <style>
{css_content}
    </style>
</head>
<body>
    <div class="screenplay">
{body_content}
    </div>
</body>
</html>"""
        return html

    @classmethod
    def _get_print_css(cls) -> str:
        """
        Get the print CSS for screenplay formatting.

        Returns:
            CSS content string
        """
        css_path = TEMPLATE_DIR / "screenplay_print.css"
        if css_path.exists():
            return css_path.read_text()

        # Fallback inline CSS if file doesn't exist
        return cls._get_fallback_css()

    @classmethod
    def _get_fallback_css(cls) -> str:
        """Fallback CSS if template file is missing."""
        return """
/* Fallback screenplay print CSS */
@page {
    size: Letter;
    margin: 1in 1in 0.75in 1.5in;
}

body {
    font-family: 'Courier Prime', 'Courier New', Courier, monospace;
    font-size: 12pt;
    line-height: 12pt;
    color: #000;
    background: #fff;
    margin: 0;
    padding: 0;
}

.screenplay p {
    margin: 0;
    padding: 0;
}

.screenplay .scene-heading {
    text-transform: uppercase;
    margin-top: 24pt;
    margin-bottom: 12pt;
}

.screenplay .action {
    margin-top: 12pt;
    margin-bottom: 12pt;
}

.screenplay .character {
    text-transform: uppercase;
    margin-left: 2in;
    margin-top: 12pt;
    margin-bottom: 0;
}

.screenplay .dialogue {
    margin-left: 1in;
    width: 3.5in;
    margin-bottom: 12pt;
}

.screenplay .parenthetical {
    margin-left: 1.4in;
    width: 2.7in;
}

.screenplay .transition {
    text-align: right;
    text-transform: uppercase;
    margin-top: 12pt;
    margin-bottom: 12pt;
}

.screenplay .transition::after {
    content: ':';
}
"""

    @classmethod
    async def _render_pdf(cls, html_content: str) -> bytes:
        """
        Render HTML to PDF using Playwright.

        Args:
            html_content: Complete HTML document string

        Returns:
            PDF file as bytes

        Raises:
            RuntimeError: If Playwright or Chromium is not installed
        """
        try:
            from playwright.async_api import async_playwright
        except ImportError:
            logger.error("Playwright not installed")
            raise RuntimeError(
                "Playwright not installed. Run: pip install playwright && playwright install chromium"
            )

        async with async_playwright() as p:
            # Launch browser
            try:
                browser = await p.chromium.launch()
            except Exception as e:
                if "Executable doesn't exist" in str(e):
                    logger.error("Chromium browser not installed for Playwright")
                    raise RuntimeError(
                        "Chromium not installed. Run: playwright install chromium"
                    )
                raise

            try:
                page = await browser.new_page()

                # Set content and wait for it to load
                await page.set_content(html_content, wait_until='networkidle')

                # Generate PDF with screenplay-standard settings
                pdf_bytes = await page.pdf(
                    format='Letter',
                    margin={
                        'top': '1in',
                        'bottom': '0.75in',
                        'left': '1.5in',
                        'right': '1in',
                    },
                    print_background=True,
                )

                return pdf_bytes
            finally:
                await browser.close()


# Convenience function
async def generate_pdf(title: str, content_blocks: List[Dict[str, Any]]) -> bytes:
    """
    Generate a PDF from screenplay content blocks.

    Convenience function that delegates to PDFExporter.generate_pdf().

    Args:
        title: Script title
        content_blocks: List of content block dicts with 'type' and 'text'

    Returns:
        PDF file as bytes
    """
    return await PDFExporter.generate_pdf(title, content_blocks)
