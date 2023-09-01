UUID := $(shell jq .uuid metadata.json -r)
VERSION := $(shell jq .version metadata.json -r)

$(UUID)-$(VERSION).zip: extension.js metadata.json LICENSE
	zip $@ $^
