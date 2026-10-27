"""Build only the hub and explicitly published apps for GitHub Pages (stdlib only)."""

import html
import json
from pathlib import Path, PurePosixPath
import re
import shutil
from urllib.parse import quote


REPO_ROOT = Path(__file__).resolve().parent.parent
ARCHIVE_URL = "https://github.com/DylanSchneider/DylanSchneider.github.io/tree/"
PUBLIC_SUFFIXES = {
    ".html", ".css", ".js", ".mjs", ".json", ".svg", ".png", ".jpg", ".jpeg",
    ".gif", ".webp", ".avif", ".ico", ".woff", ".woff2", ".ttf", ".otf",
    ".mp3", ".mp4", ".webm", ".ogg", ".wav", ".pdf", ".webmanifest", ".wasm",
    ".txt", ".xml",
}


def public_files(source, destination):
    """Resolve an explicit public path, rejecting links and non-web files."""
    if source.is_symlink():
        raise ValueError("Symlinks cannot be published: {}".format(source))
    if source.name.startswith("."):
        raise ValueError("Hidden files cannot be published: {}".format(source))
    if source.is_dir():
        for child in sorted(source.iterdir()):
            yield from public_files(child, destination / child.name)
    elif source.is_file() and source.suffix.lower() in PUBLIC_SUFFIXES:
        yield source, destination
    else:
        raise ValueError("Missing or non-web file in publish list: {}".format(source))


def app_card(app, number):
    escape = lambda value: html.escape(str(value), quote=True)
    if app["published"]:
        status = '<span class="status status-live">Available</span>'
        action = '<a href="apps/{}/">Open app <span aria-hidden="true">→</span></a>'.format(app["slug"])
    else:
        status = '<span class="status">Archived</span>'
        action = '<span class="offline-note">Currently offline</span>'
        if app.get("archive_tag"):
            action += '<a href="{}{}">View archived code <span aria-hidden="true">↗</span></a>'.format(
                ARCHIVE_URL, quote(app["archive_tag"], safe="")
            )
    edition = '<p class="app-edition">{}</p>'.format(escape(app.get("edition", "")))
    return (
        '<article class="app-card">'
        '<div class="card-top"><span class="app-number">{number:02d}</span>{status}</div>'
        '<h3>{name}</h3><p class="app-description">{description}</p>{edition}'
        '<div class="card-action">{action}</div></article>'
    ).format(number=number, status=status, name=escape(app["name"]),
             description=escape(app["description"]), edition=edition, action=action)


def build(repo_root=REPO_ROOT):
    repo_root = Path(repo_root).resolve()
    output = repo_root / "_site"
    # Never follow an output link or remove anything outside this fixed build directory.
    if output.is_symlink() or output.resolve().parent != repo_root:
        raise ValueError("Build output must be the repository's own _site directory.")
    apps = json.loads((repo_root / "apps.json").read_text(encoding="utf-8"))
    if not isinstance(apps, list):
        raise ValueError("apps.json must contain a list of apps.")
    copies = []
    cards = []
    slugs = set()
    for number, app in enumerate(apps, 1):
        slug = app["slug"]
        if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", slug) or slug in slugs:
            raise ValueError("Invalid or duplicate app slug: {}".format(slug))
        slugs.add(slug)
        if type(app["published"]) is not bool:
            raise ValueError("published must be true or false: {}".format(slug))
        app_root = repo_root / "apps" / slug
        if not app_root.is_dir() or app_root.resolve() != app_root:
            raise ValueError("Missing app folder or linked app path: {}".format(slug))
        if app["published"]:
            if not isinstance(app["files"], list) or "index.html" not in app["files"]:
                raise ValueError("Published apps must include index.html in files.")
            for entry in app["files"]:
                path = PurePosixPath(entry)
                if not entry or "\\" in entry or ":" in entry or path.is_absolute() or any(
                    part in (".", "..") or part.startswith(".") for part in entry.split("/")
                ):
                    raise ValueError("Publish paths must stay inside the app: {}".format(entry))
                source = app_root.joinpath(*path.parts)
                if source.resolve() != source:
                    raise ValueError("Linked paths cannot be published: {}".format(entry))
                copies.extend(public_files(source, output / "apps" / slug / path))
        cards.append(app_card(app, number))
    template = (repo_root / "site" / "index.html").read_text(encoding="utf-8")
    if template.count("<!-- APP_CARDS -->") != 1:
        raise ValueError("The hub template must contain one APP_CARDS placeholder.")
    hub = template.replace("<!-- APP_CARDS -->", "\n".join(cards))
    # Resolve and validate the complete manifest before replacing a previous build.
    if output.exists():
        shutil.rmtree(str(output))
    output.mkdir()
    (output / "index.html").write_text(hub, encoding="utf-8")
    for filename in ("styles.css", "404.html"):
        shutil.copyfile(str(repo_root / "site" / filename), str(output / filename))
    (output / ".nojekyll").touch()
    for source, destination in copies:
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(str(source), str(destination))
    return output


if __name__ == "__main__":
    result = build()
    print("Built {}".format(result))
