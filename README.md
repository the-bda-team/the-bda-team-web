# The BDA Team Web

Personal web page of the BDA team

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

