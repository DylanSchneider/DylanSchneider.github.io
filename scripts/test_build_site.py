"""Regression checks for the boundary between archived source and hosted apps."""

import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import unittest


SPEC = importlib.util.spec_from_file_location("build_site", Path(__file__).with_name("build-site.py"))
BUILDER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BUILDER)


class PublishingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        shutil.copytree(str(BUILDER.REPO_ROOT / "site"), str(self.root / "site"))
        self.app = self.root / "apps" / "example"
        (self.app / "assets").mkdir(parents=True)
        (self.app / "index.html").write_text('<link href="assets/style.css">', encoding="utf-8")
        (self.app / "assets" / "style.css").write_text("body { color: green; }", encoding="utf-8")
        (self.app / "schema.sql").write_text("PRIVATE DATABASE SOURCE", encoding="utf-8")
        (self.app / "secrets.local.md").write_text("PRIVATE LOCAL NOTES", encoding="utf-8")
        self.manifest = [{"slug": "example", "name": "Example", "description": "An app",
                          "published": True, "files": ["index.html", "assets"]}]

    def build(self):
        (self.root / "apps.json").write_text(json.dumps(self.manifest), encoding="utf-8")
        return BUILDER.build(self.root)

    def test_publishes_only_selected_app_files_at_subpath(self):
        output = self.build()
        self.assertEqual(
            {p.relative_to(output).as_posix() for p in output.rglob("*") if p.is_file()},
            {"index.html", "styles.css", "404.html", ".nojekyll",
             "apps/example/index.html", "apps/example/assets/style.css"}
        )
        self.assertIn('href="apps/example/"', (output / "index.html").read_text(encoding="utf-8"))

    def test_archiving_removes_previously_published_files(self):
        self.build()
        self.manifest[0].update(published=False, archive_tag="2026_AliceInWonderland")
        output = self.build()
        self.assertFalse((output / "apps").exists())
        hub = (output / "index.html").read_text(encoding="utf-8")
        self.assertNotIn('href="apps/example/"', hub)
        self.assertIn("2026_AliceInWonderland", hub)

    def test_multiple_apps_publish_independently(self):
        second = self.root / "apps" / "second"
        second.mkdir()
        (second / "index.html").write_text("Second app", encoding="utf-8")
        self.manifest.append(dict(self.manifest[0], slug="second", files=["index.html"]))
        self.manifest[0]["published"] = False
        output = self.build()
        self.assertTrue((output / "apps" / "second" / "index.html").is_file())
        self.assertFalse((output / "apps" / "example").exists())

    def test_rejects_traversal_and_non_web_files(self):
        for entry in ("../../site/styles.css", "/index.html", "C:/secret.txt",
                      "assets/../../site/styles.css", "assets\\style.css",
                      "schema.sql", "secrets.local.md", ".env", "."):
            with self.subTest(entry=entry):
                self.manifest[0]["files"] = ["index.html", entry]
                with self.assertRaises(ValueError):
                    self.build()

    def test_rejects_hidden_files_inside_public_directory(self):
        (self.app / "assets" / ".env").write_text("SECRET", encoding="utf-8")
        with self.assertRaises(ValueError):
            self.build()

    def test_rejects_duplicate_or_unsafe_slugs_and_non_boolean_status(self):
        original = dict(self.manifest[0])
        for changes in ({"slug": "../outside"}, {"slug": "Example"}, {"published": "false"}):
            with self.subTest(changes=changes):
                self.manifest = [dict(original, **changes)]
                with self.assertRaises(ValueError):
                    self.build()
        self.manifest = [original, original]
        with self.assertRaises(ValueError):
            self.build()

    def test_escapes_app_metadata(self):
        self.manifest[0]["name"] = '<script>alert("name")</script>'
        output = self.build()
        hub = (output / "index.html").read_text(encoding="utf-8")
        self.assertNotIn("<script>", hub)
        self.assertIn("&lt;script&gt;", hub)

    def test_rejects_missing_entrypoint(self):
        self.manifest[0]["files"] = ["assets"]
        with self.assertRaises(ValueError):
            self.build()


if __name__ == "__main__":
    unittest.main()
