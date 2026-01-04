# The BDA Team Web

Personal web page of the BDA team

After uploading PDFs to the [R2](https://dash.cloudflare.com/b30cbdf5bd2a6f2d7f7df34988116729/r2/default/buckets/bda-team), run the [update-resources-list workflow](https://github.com/the-bda-team/the-bda-team-web/actions/workflows/update-resources-list.yml) to add links to them from the publications page.

## Local Development

This repository uses automated checking to ensure that the json files follow the respectiv schemata. To automatically run the same checks used on GitHub after an commit before you commit them locally, install the [pre-commit](https://pre-commit.ci/) hooks:

```
# requires pre-commit installed
pre-commit install
```

To view the generated web pages locally, run

```
# requires bundle (ruby) installed
bundle exec jekyll serve
```

