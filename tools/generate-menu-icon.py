"""Derive the launcher SVG and PNG from the full-color QuickAssist logo.

Run with: uv run --with cairosvg python tools/generate-menu-icon.py
"""
from copy import deepcopy
from pathlib import Path
import xml.etree.ElementTree as ET

import cairosvg

ROOT = Path(__file__).resolve().parents[1]
SVG_NS = 'http://www.w3.org/2000/svg'
ET.register_namespace('', SVG_NS)

source = ET.parse(ROOT / 'assets/QuickAssist.svg').getroot()
menu = ET.Element(f'{{{SVG_NS}}}svg', {
    'width': source.attrib['width'],
    'height': source.attrib['height'],
    'viewBox': source.attrib['viewBox'],
    'role': 'img',
    'aria-labelledby': 'title desc',
})
ET.SubElement(menu, f'{{{SVG_NS}}}title', {'id': 'title'}).text = 'QuickAssist menu icon'
ET.SubElement(menu, f'{{{SVG_NS}}}desc', {'id': 'desc'}).text = (
    'A rounded black house outline and a solid blue speech bubble, '
    'on a transparent background.'
)
# Keep the edited house and bubble geometry and gradient; omit the background
# and waveform. These IDs belong to the source SVG's Inkscape shapes.
for shape_id in ['defs3', 'path3', 'path4', 'path5', 'path6']:
    original = source.find(f".//*[@id='{shape_id}']")
    if original is None:
        raise ValueError(f'Missing logo shape: {shape_id}')
    shape = deepcopy(original)
    for element in shape.iter():
        for attribute in list(element.attrib):
            if attribute.startswith('{'):
                del element.attrib[attribute]
    if shape_id in ['path3', 'path4', 'path5']:
        for attribute in ['fill', 'stroke']:
            if shape.get(attribute, '').lower() == '#ffffff':
                shape.set(attribute, '#000000')
    menu.append(shape)

ET.indent(menu, space='  ')
menu_svg = ROOT / 'assets/QuickAssist-menu.svg'
ET.ElementTree(menu).write(menu_svg, encoding='unicode')
menu_svg.write_text(menu_svg.read_text() + '\n')
cairosvg.svg2png(
    url=str(menu_svg), write_to=str(ROOT / 'resources/images/menu-icon.png'),
    output_width=25, output_height=25,
)
